import { StrictMode, useEffect, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QuickCapturePanel } from "../../src/components/QuickCapturePanel";
import { QuickCaptureRouter, type QuickCaptureRouting } from "../../src/lib/quick-capture-router";
import { I18nProvider } from "../../src/lib/i18n";
import { useSettingsStore } from "../../src/stores/settings-store";
import type { QuickCaptureRequest, QuickCaptureState, QuickCaptureTarget } from "../../shared/types/productivity";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const tick = () => new Promise((resolve) => setTimeout(resolve, 16));
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 3_000;
  while (!check()) { if (Date.now() >= deadline) throw new Error("Quick capture DOM condition timed out"); await tick(); }
}

function fixture(initialState: QuickCaptureState = "waitingUI") {
  const target = { projectId: "fixture-project", agentId: "fixture-agent" };
  let request: QuickCaptureRequest = { requestId: crypto.randomUUID(), action: "analyzeClipboard", state: initialState,
    createdAt: Date.now(), expiresAt: Date.now() + 300_000, clipboardText: "Synthetic clipboard fixture", target,
    error: initialState === "awaitingUser" ? { code: "DRAFT_CONFLICT", message: "Send or clear your unsent draft before continuing. Your text and attachments are preserved.", retryable: true } : null,
    dispatchAccepted: initialState === "dispatched" };
  if (request.dispatchAccepted) request.clipboardText = null;
  const counts = { checks: 0, drafts: 0, sends: 0 };
  const work: Promise<void>[] = [];
  const errors: unknown[] = [];
  let release!: () => void;
  const account = new Promise<null>((resolve) => { release = () => resolve(null); });
  let focus = "original-pane";
  const routing: QuickCaptureRouting = {
    api: { pending: async () => ({ ok: true, value: request.state === "completed" || request.state === "cancelled" ? null : structuredClone(request) }),
      update: async (update) => {
        request = { ...request, ...update, error: update.error ?? null };
        if (update.state === "dispatched") request.dispatchAccepted = true;
        if (request.dispatchAccepted || update.state === "cancelled" || update.state === "completed") request.clipboardText = null;
        return { ok: true, value: structuredClone(request) };
      } },
    focusedId: () => focus, focusedIdentity: () => focus, defaultTarget: () => target, validTarget: () => true,
    blocked: () => false, activate: () => {}, hasDraft: () => false,
    composer: () => ({ focus: () => true, hasDraft: () => false, dictate: async () => {} }),
    checkTarget: async () => { counts.checks++; return account; },
    createDraft: async () => { counts.drafts++; focus = "draft"; return { composerId: "draft", identity: "draft" }; },
    ownsDraft: (_target, identity) => identity === focus, draftReadiness: () => "ready", saveTarget: async () => {},
    send: async () => { counts.sends++; return {}; },
  };
  const router = new QuickCaptureRouter(routing);
  const container = document.createElement("section"); document.body.append(container);
  let root = createRoot(container);
  const track = (promise: Promise<void>) => { work.push(promise); void promise.catch((error: unknown) => errors.push(error)); return promise; };
  function Harness() {
    const current = useSyncExternalStore(router.subscribe, router.getSnapshot, router.getSnapshot);
    useEffect(() => { void track(router.receive()); }, []);
    return current && <QuickCapturePanel request={current}
      projects={[{ id: target.projectId, name: "Fixture project", path: "/fixture", createdAt: 1 }]}
      agents={[{ id: target.agentId, name: "Fixture agent", engine: "claude" }]}
      onContinue={(selected?: QuickCaptureTarget) => track(router.resume(selected))} onDismiss={() => track(router.dismiss())}
      onCreateProject={async () => {}} onOpenSettings={() => {}} />;
  }
  const mount = () => flushSync(() => root.render(<StrictMode><I18nProvider><Harness /></I18nProvider></StrictMode>));
  mount();
  const button = (label: string) => {
    const result = [...container.querySelectorAll("button")].find((entry) => entry.textContent === label);
    assert(result, `Missing button: ${label}`); return result;
  };
  return { container, counts, router, button, release, request: () => request,
    remount: () => { flushSync(() => root.unmount()); root = createRoot(container); mount(); },
    settle: async () => { await Promise.all(work); assert(errors.length === 0, `Quick capture callback failed: ${String(errors[0])}`); },
    unmount: () => { flushSync(() => root.unmount()); container.remove(); },
  };
}

async function runQuickCaptureChecks() {
  useSettingsStore.getState().setLanguage("en-US");
  const results: string[] = [];
  let f = fixture();
  try {
    await waitFor(() => !!f.container.querySelector('[role="status"]'));
    assert(f.button("Continue").disabled && !f.button("Cancel").disabled, "Preparing state disables cancellation or enables a second continue");
    f.remount(); await tick();
    assert(f.counts.checks === 1, "StrictMode/remount repeated account checks");
    const modal = document.createElement("div"); modal.setAttribute("aria-modal", "true"); document.body.append(modal);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await tick(); assert(f.request().state === "waitingUI", "Escape bypassed a modal dialog"); modal.remove();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    await waitFor(() => f.container.childElementCount === 0);
    f.release(); await f.settle();
    assert(f.counts.drafts === 0 && f.counts.sends === 0 && f.request().clipboardText === null, "Cancelled account check created or sent a late draft");
    results.push("preparing state, StrictMode/remount, modal Escape priority and late authentication cancellation passed");
  } finally { f.release(); f.unmount(); }

  f = fixture("awaitingUser");
  try {
    await waitFor(() => !!f.container.querySelector("button"));
    assert(!f.button("Continue").disabled, "Resolved pending request cannot continue");
    f.button("Continue").click();
    await waitFor(() => f.counts.checks === 1);
    assert(!f.button("Cancel").disabled, "An outstanding Continue promise prevents cancellation");
    f.button("Cancel").click();
    await waitFor(() => f.container.childElementCount === 0);
    f.release(); await f.settle();
    assert(f.counts.drafts === 0 && f.counts.sends === 0, "Cancel after Continue sent a prompt");
    results.push("Cancel remains operable during an outstanding Continue action");
  } finally { f.release(); f.unmount(); }

  f = fixture("dispatched");
  try {
    await waitFor(() => f.router.getSnapshot()?.error?.code === "DELIVERY_UNKNOWN");
    f.remount(); await tick();
    assert(![...f.container.querySelectorAll("button")].some((entry) => entry.textContent === "Continue"), "Claimed request offers replay");
    f.button("Dismiss").click();
    await waitFor(() => f.container.childElementCount === 0);
    await f.settle();
    assert(f.counts.sends === 0 && f.request().dispatchAccepted, "Remount replayed or released the delivery claim");
    results.push("unknown delivery remains non-replayable across remount and dismissal");
  } finally { f.release(); f.unmount(); }
  return results;
}

Object.assign(window, { runQuickCaptureChecks });
