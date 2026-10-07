import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickCaptureRouter, clipboardAnalysisPrompt, type QuickCaptureRouting } from "./quick-capture-router";
import { QuickCapture } from "../../electron/src/lib/quick-capture";
import type { OperationError, QuickCaptureAction } from "@shared/types/productivity";

afterEach(() => { vi.useRealTimers(); });

function setup(action: QuickCaptureAction = "analyzeClipboard") {
  vi.useFakeTimers();
  const service = new QuickCapture(() => {});
  const target = { projectId: "project-1", agentId: "claude-code" };
  const state = { id: "existing-pane" as string | null, identity: "existing-pane" as string | null, draft: false, blocked: false, readiness: "ready" as "ready" | "authRequired" | "preparing", authError: null as OperationError | null };
  const composer = { focus: vi.fn(() => true), hasDraft: () => state.draft, dictate: vi.fn(async () => {}) };
  const routing: QuickCaptureRouting = {
    api: { pending: async () => ({ ok: true, value: service.pending() }), update: async (update) => {
      try { return { ok: true, value: service.update(update) }; }
      catch (error) { return { ok: false, error: { code: "INVALID_ARGUMENT", message: String(error), retryable: false } }; }
    } },
    focusedId: () => state.id, focusedIdentity: () => state.identity, defaultTarget: () => target, validTarget: () => true,
    blocked: () => state.blocked, activate: vi.fn(), composer: () => composer, hasDraft: () => state.draft,
    checkTarget: vi.fn(async () => state.authError),
    createDraft: vi.fn(async () => { state.id = "__draft__"; state.identity = "capture-draft"; return { composerId: state.id, identity: state.identity }; }),
    ownsDraft: (_target, identity) => state.id === "__draft__" && state.identity === identity, draftReadiness: () => state.readiness,
    saveTarget: vi.fn(async () => {}), send: vi.fn(async () => ({})),
  };
  const request = service.capture(action, () => "/clear\n```text\nclipboard text", target);
  const router = new QuickCaptureRouter(routing);
  return { router, service, routing, target, state, composer, request };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("QuickCaptureRouter", () => {
  it("preserves text, attachments and voice drafts by pausing before any new session is created", async () => {
    const { router, routing, state, target } = setup();
    state.draft = true;
    await router.receive();
    expect(router.getSnapshot()?.error?.code).toBe("DRAFT_CONFLICT");
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(routing.send).not.toHaveBeenCalled();
    state.draft = false;
    await router.resume(target);
    expect(routing.createDraft).toHaveBeenCalledTimes(1);
    expect(routing.send).toHaveBeenCalledTimes(1);
    expect(router.getSnapshot()).toBeNull();
  });
  it("dispatches once when notifications and refreshes race, wrapping slash commands as quoted material", async () => {
    const { router, routing, service } = setup();
    await Promise.all([router.receive(), router.receive(), router.receive()]);
    expect(routing.send).toHaveBeenCalledExactlyOnceWith(clipboardAnalysisPrompt("/clear\n```text\nclipboard text"));
    expect(service.pending()).toBeNull();
    expect(clipboardAnalysisPrompt("/clear")).not.toMatch(/^\//);
    expect(clipboardAnalysisPrompt("```text")).toContain("````text\n```text\n````");
  });
  it("does not create a conversation until missing authentication is resolved", async () => {
    const { router, routing, state, target } = setup();
    state.authError = { code: "AUTH_REQUIRED", message: "Sign in", retryable: true };
    await router.receive();
    expect(router.getSnapshot()?.state).toBe("awaitingUser");
    expect(routing.createDraft).not.toHaveBeenCalled();
    state.authError = null;
    await router.resume(target);
    expect(routing.send).toHaveBeenCalledTimes(1);
  });
  it("checks drafts again after asynchronous account checks", async () => {
    const { router, routing, state } = setup();
    routing.checkTarget = async () => { state.draft = true; return null; };
    await router.receive();
    expect(router.getSnapshot()?.error?.code).toBe("DRAFT_CONFLICT");
    expect(routing.createDraft).not.toHaveBeenCalled();
  });
  it("does not route a captured request into a different pane while waiting for focus", async () => {
    const { router, state, composer, routing } = setup("dictate");
    composer.focus.mockReturnValue(false);
    const pending = router.receive();
    await vi.advanceTimersByTimeAsync(60);
    state.id = "another-pane";
    await vi.advanceTimersByTimeAsync(60);
    await pending;
    expect(router.getSnapshot()?.error?.code).toBe("TARGET_CHANGED");
    expect(composer.dictate).not.toHaveBeenCalled();
    expect(routing.createDraft).not.toHaveBeenCalled();
  });
  it("wakes an existing pane with a draft without modifying it or reading target settings", async () => {
    const { router, state, composer, routing } = setup("wake");
    state.draft = true;
    await router.receive();
    expect(composer.focus).toHaveBeenCalled();
    expect(routing.checkTarget).not.toHaveBeenCalled();
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(state.draft).toBe(true);
  });
  it("does not replay a claimed request after a lost send result or component remount", async () => {
    const { router, service, routing, request } = setup();
    service.update({ requestId: request.requestId, state: "ready" });
    service.update({ requestId: request.requestId, state: "dispatched" });
    await router.receive();
    expect(router.getSnapshot()?.error?.code).toBe("DELIVERY_UNKNOWN");
    const remounted = new QuickCaptureRouter(routing);
    await remounted.receive();
    await remounted.resume();
    expect(routing.send).not.toHaveBeenCalled();
    await remounted.dismiss();
    expect(service.pending()).toBeNull();
  });
  it("guards the target again after the asynchronous dispatch claim", async () => {
    const { router, state, routing } = setup();
    const update = routing.api.update;
    routing.api.update = async (request) => {
      const result = await update(request);
      if (request.state === "dispatched") state.id = "another-project";
      return result;
    };
    await router.receive();
    expect(routing.send).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.dispatchAccepted).toBe(true);
    expect(router.getSnapshot()?.error?.retryable).toBe(false);
  });
  it("cancels an outstanding account check and never creates a draft from its late result", async () => {
    const { router, routing, service } = setup();
    const check = deferred<OperationError | null>();
    routing.checkTarget = () => check.promise;
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    expect(router.getSnapshot()?.state).toBe("waitingUI");
    await router.dismiss();
    expect(service.pending()).toBeNull();
    check.resolve(null);
    await running;
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(routing.send).not.toHaveBeenCalled();
    expect(router.getSnapshot()).toBeNull();
  });
  it("does not create a draft when authentication finishes after the UI readiness deadline", async () => {
    const { router, routing } = setup();
    const check = deferred<OperationError | null>();
    routing.checkTarget = () => check.promise;
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(5_001);
    check.resolve(null);
    await running;
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.error?.code).toBe("UI_NOT_READY");
  });
  it("does not resurrect a paused request when its update reply arrives after cancellation", async () => {
    const { router, routing, state } = setup();
    state.draft = true;
    const reply = deferred<void>();
    const update = routing.api.update;
    routing.api.update = async (request) => {
      const result = await update(request);
      if (request.state === "awaitingUser") await reply.promise;
      return result;
    };
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    await router.dismiss();
    reply.resolve();
    await running;
    expect(router.getSnapshot()).toBeNull();
    expect(routing.createDraft).not.toHaveBeenCalled();
  });
  it("does not treat a replacement draft in the same project as the prepared target", async () => {
    const { router, routing, state, composer } = setup();
    composer.focus.mockReturnValue(false);
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    state.identity = "another-draft-in-the-same-project";
    composer.focus.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(50);
    await running;
    expect(routing.send).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.error?.code).toBe("TARGET_CHANGED");
  });
  it("rechecks the draft and blocking dialogs after saving an explicitly selected target", async () => {
    const { router, routing, state, target } = setup();
    state.draft = true;
    await router.receive();
    state.draft = false;
    routing.saveTarget = async () => { state.blocked = true; };
    await router.resume(target);
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.error?.code).toBe("UI_BLOCKED");
  });
  it("does not start dictation if focus changes while the dispatch claim is in flight", async () => {
    const { router, routing, composer, state } = setup("dictate");
    const update = routing.api.update;
    routing.api.update = async (request) => {
      const result = await update(request);
      if (request.state === "dispatched") state.id = "another-pane";
      return result;
    };
    await router.receive();
    expect(composer.dictate).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.dispatchAccepted).toBe(true);
    expect(router.getSnapshot()?.error?.retryable).toBe(false);
  });
  it("keeps the identity of an existing draft while waiting to start dictation", async () => {
    const { router, state, composer } = setup("dictate");
    state.id = "__draft__"; state.identity = "manual-draft";
    composer.focus.mockReturnValue(false);
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    state.identity = "new-manual-draft";
    composer.focus.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(50);
    await running;
    expect(composer.dictate).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.error?.code).toBe("TARGET_CHANGED");
  });
  it("pins an absent focus and default project instead of adopting a later selection", async () => {
    const { router, routing, state } = setup("wake");
    state.id = null; state.identity = null;
    let defaultTarget: ReturnType<QuickCaptureRouting["defaultTarget"]> = null;
    routing.defaultTarget = () => defaultTarget;
    const pending = routing.api.pending;
    const reply = deferred<void>();
    routing.api.pending = async () => { await reply.promise; return pending(); };
    const running = router.receive();
    state.id = "another-pane"; state.identity = "another-pane";
    defaultTarget = { projectId: "another-project", agentId: "claude-code" };
    reply.resolve();
    await running;
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(router.getSnapshot()?.state).toBe("awaitingUser");
  });
  it("reuses the exact prepared draft after authentication instead of creating another one", async () => {
    const { router, routing, state } = setup("dictate");
    state.id = null; state.identity = null; state.readiness = "authRequired";
    await router.receive();
    expect(router.getSnapshot()?.error?.code).toBe("AUTH_REQUIRED");
    state.readiness = "ready";
    await router.resume();
    expect(routing.createDraft).toHaveBeenCalledTimes(1);
    expect(router.getSnapshot()).toBeNull();
  });
  it("retains a newer request when an older cancelled account check finally returns", async () => {
    const { router, routing, service, state } = setup();
    const check = deferred<OperationError | null>();
    routing.checkTarget = () => check.promise;
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    await router.dismiss();
    const next = service.capture("analyzeClipboard", () => "second request", null);
    state.draft = true;
    await router.receive();
    check.resolve(null);
    await running;
    expect(router.getSnapshot()?.requestId).toBe(next.requestId);
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(routing.send).not.toHaveBeenCalled();
  });
  it("allows retry after a timeout without waiting for the old account check to settle", async () => {
    const { router, routing } = setup();
    const check = deferred<OperationError | null>();
    routing.checkTarget = () => check.promise;
    const oldRun = router.receive();
    await vi.advanceTimersByTimeAsync(5_001);
    await router.receive();
    routing.checkTarget = async () => null;
    await router.resume();
    expect(routing.send).toHaveBeenCalledTimes(1);
    check.resolve(null);
    await oldRun;
    expect(routing.send).toHaveBeenCalledTimes(1);
    expect(router.getSnapshot()).toBeNull();
  });
  it("does not resume a request whose waiting-state reply arrives after dismissal", async () => {
    const { router, routing, state } = setup();
    state.draft = true;
    await router.receive();
    state.draft = false;
    const reply = deferred<void>();
    const update = routing.api.update;
    routing.api.update = async (request) => {
      const result = await update(request);
      if (request.state === "waitingUI") await reply.promise;
      return result;
    };
    const resuming = router.resume();
    await vi.advanceTimersByTimeAsync(0);
    await router.dismiss();
    reply.resolve();
    await resuming;
    expect(routing.activate).toHaveBeenCalledTimes(1);
    expect(routing.createDraft).not.toHaveBeenCalled();
    expect(router.getSnapshot()).toBeNull();
  });
  it("cancels even when the claim commits after dismissal reads the ready state", async () => {
    const { router, routing, service } = setup();
    const claim = deferred<void>(), pendingReply = deferred<void>();
    const update = routing.api.update, pending = routing.api.pending;
    let holdPending = false;
    routing.api.update = async (request) => { if (request.state === "dispatched") await claim.promise; return update(request); };
    routing.api.pending = async () => { const result = await pending(); if (holdPending) await pendingReply.promise; return result; };
    const running = router.receive();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.pending()?.state).toBe("ready");
    holdPending = true;
    const dismissing = router.dismiss();
    await vi.advanceTimersByTimeAsync(0);
    claim.resolve(); await running;
    pendingReply.resolve(); await dismissing;
    expect(routing.send).not.toHaveBeenCalled();
    expect(service.pending()).toBeNull();
    expect(router.getSnapshot()).toBeNull();
  });
  it("continues to reject a new same-project draft after a prepared dictation request pauses", async () => {
    const { router, state, composer, routing } = setup("dictate");
    state.id = null; state.identity = null; state.readiness = "authRequired";
    await router.receive();
    state.identity = "new-manual-draft"; state.readiness = "ready";
    await router.resume();
    expect(composer.dictate).not.toHaveBeenCalled();
    expect(routing.createDraft).toHaveBeenCalledTimes(1);
    expect(router.getSnapshot()?.error?.code).toBe("TARGET_CHANGED");
  });
  it("honors an explicit replacement for an invalid prepared dictation target", async () => {
    const { router, state, routing, composer } = setup("dictate");
    state.id = null; state.identity = null; state.readiness = "authRequired";
    await router.receive();
    const replacement = { projectId: "replacement-project", agentId: "replacement-agent" };
    routing.validTarget = (candidate) => candidate.projectId === replacement.projectId;
    state.readiness = "ready";
    await router.resume(replacement);
    expect(routing.createDraft).toHaveBeenCalledTimes(2);
    expect(routing.createDraft).toHaveBeenLastCalledWith(replacement);
    expect(composer.dictate).toHaveBeenCalledTimes(1);
    expect(router.getSnapshot()).toBeNull();
  });
});
