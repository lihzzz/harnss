import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickCapture } from "../quick-capture";

afterEach(() => { vi.useRealTimers(); });

describe("QuickCapture", () => {
  it("reads clipboard once, shares a pending request and broadcasts only metadata", () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const read = vi.fn(() => "/clear private quoted material");
    const service = new QuickCapture(notify);
    const first = service.capture("analyzeClipboard", read, null);
    const repeated = service.capture("analyzeClipboard", read, null);
    expect(read).toHaveBeenCalledTimes(1);
    expect(repeated.requestId).toBe(first.requestId);
    expect(Object.keys(notify.mock.calls[0][0]).sort()).toEqual(["action", "createdAt", "requestId"]);
    service.update({ requestId: first.requestId, state: "ready" });
    service.update({ requestId: first.requestId, state: "dispatched" });
    expect(service.pending()?.clipboardText).toBeNull();
    expect(() => service.update({ requestId: first.requestId, state: "dispatched" })).toThrow("already accepted");
    service.update({ requestId: first.requestId, state: "failed", error: { code: "UNKNOWN", message: "response lost", retryable: true } });
    expect(() => service.update({ requestId: first.requestId, state: "waitingUI" })).toThrow("cannot be replayed");
    service.dispose();
  });
  it("checks UTF-8 bytes and rejects blank clipboard content without retaining it", () => {
    vi.useFakeTimers();
    const service = new QuickCapture(() => {});
    expect(service.capture("analyzeClipboard", () => "中".repeat(22_000), null)).toMatchObject({ state: "failed", clipboardText: null, error: { code: "CONTENT_TOO_LARGE" } });
    expect(service.capture("analyzeClipboard", () => " \n ", null).error?.code).toBe("EMPTY_CLIPBOARD");
    service.dispose();
  });
  it("never reads clipboard for wake and allows retry only before dispatch", () => {
    vi.useFakeTimers();
    const service = new QuickCapture(() => {});
    const read = vi.fn();
    const request = service.capture("wake", read, null);
    expect(read).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(service.pending()?.error?.code).toBe("UI_NOT_READY");
    service.update({ requestId: request.requestId, state: "waitingUI" });
    service.update({ requestId: request.requestId, state: "awaitingUser" });
    vi.advanceTimersByTime(20_000);
    expect(service.pending()?.state).toBe("awaitingUser");
    vi.advanceTimersByTime(5 * 60_000);
    expect(service.pending()).toBeNull();
  });
  it("cancellation releases captured text and next trigger receives a fresh identity", () => {
    vi.useFakeTimers();
    const service = new QuickCapture(() => {});
    const request = service.capture("analyzeClipboard", () => "first", null);
    expect(service.update({ requestId: request.requestId, state: "cancelled" }).clipboardText).toBeNull();
    const next = service.capture("analyzeClipboard", () => "next", null);
    expect(next.requestId).not.toBe(request.requestId);
    expect(next.clipboardText).toBe("next");
    service.dispose();
  });
  it("rearms the UI deadline when the user continues after resolving a dialog", () => {
    vi.useFakeTimers();
    const service = new QuickCapture(() => {});
    const request = service.capture("analyzeClipboard", () => "fixture", null);
    service.update({ requestId: request.requestId, state: "awaitingUser" });
    vi.advanceTimersByTime(30_000);
    service.update({ requestId: request.requestId, state: "waitingUI" });
    vi.advanceTimersByTime(4_999);
    expect(service.pending()?.state).toBe("waitingUI");
    vi.advanceTimersByTime(1);
    expect(service.pending()?.error?.code).toBe("UI_NOT_READY");
    service.dispose();
  });
  it("dismisses a claimed request without making its identity replayable", () => {
    vi.useFakeTimers();
    const service = new QuickCapture(() => {});
    const request = service.capture("analyzeClipboard", () => "fixture", null);
    service.update({ requestId: request.requestId, state: "ready" });
    service.update({ requestId: request.requestId, state: "dispatched" });
    expect(service.update({ requestId: request.requestId, state: "cancelled" })).toMatchObject({ dispatchAccepted: true, clipboardText: null });
    expect(service.pending()).toBeNull();
    expect(() => service.update({ requestId: request.requestId, state: "waitingUI" })).toThrow("cannot be replayed");
    service.dispose();
  });
});
