import { randomUUID } from "node:crypto";
import type { QuickCaptureAction, QuickCaptureRequest, QuickCaptureState, QuickCaptureTarget, QuickCaptureUpdate } from "@shared/types/productivity";
import { ProductivityError } from "./productivity-errors";

const TRANSITIONS: Record<QuickCaptureState, QuickCaptureState[]> = {
  waitingUI: ["awaitingUser", "ready", "failed", "cancelled"], awaitingUser: ["waitingUI", "ready", "failed", "cancelled"],
  ready: ["dispatched", "awaitingUser", "failed", "cancelled"], dispatched: ["completed", "failed", "cancelled"],
  completed: [], failed: ["waitingUI", "cancelled"], cancelled: [],
};

export class QuickCapture {
  private current: QuickCaptureRequest | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(private readonly notify: (request: Pick<QuickCaptureRequest, "requestId" | "action" | "createdAt">) => void) {}

  private emit(request: QuickCaptureRequest): void {
    this.notify({ requestId: request.requestId, action: request.action, createdAt: request.createdAt });
  }

  capture(action: QuickCaptureAction, readClipboard: () => string, target: QuickCaptureTarget | null): QuickCaptureRequest {
    const pending = this.pending();
    if (pending && !["failed", "completed", "cancelled"].includes(pending.state) && pending.action !== "wake") {
      this.emit(pending);
      return pending;
    }
    if (pending?.action === "wake" && action === "wake" && !["failed", "completed", "cancelled"].includes(pending.state)) { this.emit(pending); return pending; }
    this.dispose();
    const createdAt = Date.now();
    const request: QuickCaptureRequest = { requestId: randomUUID(), action, state: "waitingUI", createdAt,
      expiresAt: createdAt + 5 * 60_000, clipboardText: null, target, error: null, dispatchAccepted: false };
    if (action === "analyzeClipboard") {
      try {
        const text = readClipboard();
        if (!text.trim()) request.error = { code: "EMPTY_CLIPBOARD", message: "Copy some text before using this shortcut", retryable: false };
        else if (Buffer.byteLength(text, "utf8") > 64 * 1024) request.error = { code: "CONTENT_TOO_LARGE", message: "Clipboard text exceeds 64 KiB; reduce it and try again", retryable: false };
        else request.clipboardText = text;
      } catch { request.error = { code: "EMPTY_CLIPBOARD", message: "Clipboard text is unavailable", retryable: true }; }
      if (request.error) request.state = "failed";
    }
    this.current = request;
    this.timer = setTimeout(() => { this.dispose(); this.emit(request); }, 5 * 60_000);
    this.timer.unref?.();
    this.armReadyTimeout(request);
    this.emit(request);
    return structuredClone(request);
  }

  private armReadyTimeout(request: QuickCaptureRequest): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (request.state !== "waitingUI") return;
    this.readyTimer = setTimeout(() => {
      if (this.current?.requestId !== request.requestId || this.current.state !== "waitingUI") return;
      this.current.state = "failed";
      this.current.error = { code: "UI_NOT_READY", message: "The input is not ready; retry after the window finishes loading", retryable: true };
      this.emit(this.current);
    }, 5_000);
    this.readyTimer.unref?.();
  }
  pending(): QuickCaptureRequest | null {
    if (this.current && Date.now() >= this.current.expiresAt) this.dispose();
    if (!this.current || this.current.state === "completed" || this.current.state === "cancelled") return null;
    return structuredClone(this.current);
  }
  update(update: QuickCaptureUpdate): QuickCaptureRequest {
    const request = this.current;
    if (!request || request.requestId !== update.requestId || Date.now() >= request.expiresAt) throw new ProductivityError("INVALID_ARGUMENT", "The quick input request has expired");
    if (request.state === "dispatched" && update.state === "dispatched") throw new ProductivityError("BUSY", "This request was already accepted; verify its conversation");
    if (request.state === update.state) {
      if (update.target) request.target = { ...update.target };
      if (update.error) request.error = update.error;
      return structuredClone(request);
    }
    if (!TRANSITIONS[request.state].includes(update.state) || (request.dispatchAccepted && update.state !== "completed" && update.state !== "failed" && update.state !== "cancelled")
      || (request.state === "failed" && update.state === "waitingUI" && !request.error?.retryable)) throw new ProductivityError("INVALID_ARGUMENT", "This quick input action cannot be replayed");
    request.state = update.state;
    if (update.target) request.target = { ...update.target };
    request.error = update.error ?? null;
    if (update.state === "dispatched") request.dispatchAccepted = true;
    if (request.dispatchAccepted || update.state === "completed" || update.state === "cancelled") request.clipboardText = null;
    this.armReadyTimeout(request);
    return structuredClone(request);
  }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.current = null;
    this.timer = null;
    this.readyTimer = null;
  }
}
