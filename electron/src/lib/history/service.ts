import { Worker } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HistoryIndexStatus } from "@shared/types/productivity";
import { ProductivityError } from "../productivity-errors";
import type { HistoryCatalog } from "./types";
import type { HistoryWorkerCommand, HistoryWorkerRequest, HistoryWorkerResponse, HistoryWorkerValue } from "./worker-protocol";

/** The main process validates IPC and owns the worker; parsing/SQL remain off its event loop. */
export class HistoryService {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, { resolve: (value: HistoryWorkerValue) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  private closing = false;
  private statusSequence = 0;
  constructor(private readonly root: string, private readonly catalog: () => HistoryCatalog, private readonly statusChanged: (status: HistoryIndexStatus) => void,
    private readonly semantic: () => { semanticEnabled: boolean; embeddingModelKey: string | null } = () => ({ semanticEnabled: false, embeddingModelKey: null })) {}

  private start(): Worker {
    if (this.worker) return this.worker;
    if (this.closing) throw new ProductivityError("HISTORY_CLOSED");
    const worker = new Worker(path.join(__dirname, "history-worker.js"), { workerData: { root: this.root } });
    const sequenceOffset = this.statusSequence + 1;
    this.worker = worker;
    worker.on("message", (message: HistoryWorkerResponse) => {
      if (this.worker !== worker) return;
      if (message.type === "status") {
        const seq = sequenceOffset + message.value.seq;
        this.statusSequence = Math.max(this.statusSequence, seq);
        this.statusChanged({ ...message.value, seq }); return;
      }
      const task = this.pending.get(message.id);
      if (!task) return;
      this.pending.delete(message.id); clearTimeout(task.timer);
      if (message.result.ok) {
        const value = message.result.value;
        task.resolve(value && "seq" in value ? { ...value, seq: sequenceOffset + value.seq } : value);
      }
      else task.reject(new ProductivityError(message.result.error.code, message.result.error.message, message.result.error.retryable));
    });
    const stopped = (error: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      for (const task of this.pending.values()) { clearTimeout(task.timer); task.reject(error); }
      this.pending.clear();
    };
    worker.on("error", stopped);
    worker.on("exit", (code) => stopped(new ProductivityError("INDEX_WORKER_STOPPED", `History worker stopped (${code})`, true)));
    return worker;
  }

  async call(command: HistoryWorkerCommand): Promise<HistoryWorkerValue> {
    const id = randomUUID();
    const worker = this.start();
    const catalog = this.catalog();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ProductivityError("HISTORY_TIMEOUT", "History is still being processed. Try again.", true));
        if (this.worker === worker && "request" in command && "requestId" in command.request) {
          // The worker may have exited between the timeout and cancellation.
          try { worker.postMessage({ id: randomUUID(), catalog, action: "cancel", requestId: command.request.requestId } satisfies HistoryWorkerRequest); } catch { /* Already rejected with the timeout. */ }
        }
      }, 60_000);
      this.pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ ...command, id, catalog, semantic: this.semantic() } satisfies HistoryWorkerRequest); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async close(): Promise<void> {
    if (!this.worker) { this.closing = true; return; }
    const worker = this.worker;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try { await Promise.race([this.call({ action: "close" }), new Promise<void>((resolve) => { timer = setTimeout(resolve, 5000); })]); }
    finally { if (timer) clearTimeout(timer); this.closing = true; await worker.terminate(); }
  }
}
