import { Worker } from "node:worker_threads";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProductivityError } from "../productivity-errors";
import type { EmbeddingCommand, EmbeddingReply, EmbeddingRequest, EmbeddingValue, ModelDownloadProgress } from "./embedding-protocol";

interface Task {
  id: string; command: EmbeddingCommand; signal: AbortSignal;
  resolve: (value: EmbeddingValue) => void; reject: (error: unknown) => void; release: () => void;
}
export class EmbeddingClient {
  private worker: Worker | null = null;
  private queue: Task[] = [];
  private active: Task | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly cacheDir: string, private readonly progress: (value: ModelDownloadProgress) => void) {}

  call(command: EmbeddingCommand, signal: AbortSignal): Promise<EmbeddingValue> {
    if (signal.aborted) return Promise.reject(new ProductivityError("CANCELLED"));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const cancel = () => {
        const index = this.queue.findIndex((task) => task.id === id);
        if (index >= 0) { this.queue.splice(index, 1); task.release(); }
        // An in-flight native batch finishes at its boundary; disabling/pausing
        // terminates the worker via stop() and also aborts model downloads.
        reject(new ProductivityError("CANCELLED"));
      };
      const task: Task = { id, command, signal, resolve, reject, release: () => signal.removeEventListener("abort", cancel) };
      signal.addEventListener("abort", cancel, { once: true });
      if (command.action === "embed" && command.kind === "query") this.queue.unshift(task); else this.queue.push(task);
      this.dispatch();
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, "embedding-worker.js"), { workerData: { cacheDir: this.cacheDir } });
    this.worker = worker;
    worker.on("message", (message: EmbeddingReply) => {
      if (this.worker !== worker) return;
      if (message.type === "download") { this.progress(message.progress); return; }
      const task = this.active;
      if (!task || task.id !== message.id) return;
      this.active = null; task.release();
      if (message.result.ok) task.resolve(message.result.value);
      else task.reject(new ProductivityError(message.result.error.code, message.result.error.message, message.result.error.retryable));
      this.dispatch();
    });
    const failed = () => { if (this.worker === worker) void this.stop(new ProductivityError("MODEL_UNAVAILABLE", "The local embedding worker stopped. Retry semantic indexing.", true)); };
    worker.on("error", failed); worker.on("exit", failed);
    return worker;
  }

  private dispatch(): void {
    if (this.active) return;
    if (this.timer) clearTimeout(this.timer);
    const task = this.queue.shift();
    if (!task) { this.timer = setTimeout(() => { void this.stop(); }, 5 * 60_000); this.timer.unref(); return; }
    this.active = task;
    this.timer = setTimeout(() => { void this.stop(new ProductivityError("MODEL_TIMEOUT", "Local model preparation or inference timed out. Retry to use the cached download.", true)); }, 5 * 60_000);
    try { this.start().postMessage({ ...task.command, id: task.id } satisfies EmbeddingRequest); }
    catch { void this.stop(new ProductivityError("MODEL_UNAVAILABLE", "The local embedding worker could not start", true)); }
  }

  async stop(error = new ProductivityError("CANCELLED")): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const tasks = [...this.queue, ...(this.active ? [this.active] : [])];
    this.queue = []; this.active = null;
    for (const task of tasks) { task.release(); task.reject(error); }
    const worker = this.worker; this.worker = null;
    await worker?.terminate();
  }
}
