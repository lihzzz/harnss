import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useEngineBase } from "../../src/hooks/useEngineBase";
import { useSessionRevival } from "../../src/hooks/session/useSessionRevival";
import { useMessageQueue } from "../../src/hooks/session/useMessageQueue";
import { BackgroundSessionStore } from "../../src/lib/background/session-store";
import { isSessionRecovering } from "../../src/lib/session/batch-runtime";
import { I18nProvider } from "../../src/lib/i18n";
import type { ACPConfigOption, ChatSession, EngineId, McpServerStatus, UIMessage } from "../../src/types";
import type { InitialMeta } from "../../src/hooks/session/types";

const sleep = (ms = 16) => new Promise((resolve) => setTimeout(resolve, ms));
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function waitFor(check: () => boolean) {
  const deadline = Date.now() + 4_000;
  while (!check()) { if (Date.now() > deadline) throw new Error("Renderer condition timed out"); await sleep(); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(engineId: EngineId, sameId = false) {
  const id = crypto.randomUUID(), nextId = sameId ? id : crypto.randomUUID(), otherId = crypto.randomUUID();
  const source: ChatSession = { id, projectId: "fixture-project", title: "Original", createdAt: 1, totalCost: 3, engine: engineId,
    agentId: "fixture-agent", agentSessionId: "fixture-agent-thread", codexThreadId: "fixture-thread", isActive: true };
  const original: UIMessage = { id: "original", role: "user", content: "Original history", timestamp: 1 };
  const other: UIMessage = { id: "other", role: "user", content: "Other history", timestamp: 2 };
  type Params = Parameters<typeof useSessionRevival>[0];
  const refs: Params["refs"] = {
    activeSessionIdRef: { current: id }, sessionsRef: { current: [source, { ...source, id: otherId, title: "Other", isActive: false }] },
    messagesRef: { current: [original] }, totalCostRef: { current: 3 }, contextUsageRef: { current: null }, isProcessingRef: { current: false },
    liveSessionIdsRef: { current: new Set() }, backgroundStoreRef: { current: new BackgroundSessionStore() }, messageQueueRef: { current: new Map() },
    startOptionsRef: { current: {} }, codexEffortRef: { current: "medium" }, acpAgentIdRef: { current: "fixture-agent" }, acpAgentSessionIdRef: { current: "fixture-agent-thread" },
  };
  const counters = { starts: 0, sends: 0, stops: 0, saves: 0 };
  let saveFails = false;
  let startGate: ReturnType<typeof deferred<void>> | null = null;
  let sendGate: ReturnType<typeof deferred<{ ok: true }>> | null = null;
  let work: Promise<void> = Promise.resolve();
  let lastSentImages: unknown;
  const start = async () => { counters.starts++; if (startGate) await startGate.promise; return { sessionId: nextId, pid: 0, threadId: "fixture-thread", agentSessionId: "fixture-agent-thread" }; };
  const send = async (...args: unknown[]) => { counters.sends++; lastSentImages = args; return sendGate ? sendGate.promise : { ok: true }; };
  const stop = async () => { counters.stops++; return { ok: true }; };
  const save = async () => { counters.saves++; return saveFails ? { error: "Fixture disk full" } : {}; };
  // This isolated page has no real preload or supplier credentials.
  window.claude = { start, send, stop, sessions: { save, append: save }, mcp: { list: async () => [] },
    codex: { resume: start, send, stop }, acp: { reviveSession: start, prompt: send, stop } } as unknown as Window["claude"];
  const container = document.createElement("section"); document.body.append(container);
  const root = createRoot(container);
  let controller!: { navigate: (target: string) => void; messages: UIMessage[]; processing: boolean };
  function Harness() {
    const [active, setActiveSessionId] = useState<string | null>(id);
    const [sessions, setSessions] = useState(refs.sessionsRef.current);
    const [initialMessages, setInitialMessages] = useState([original]);
    const [initialMeta, setInitialMeta] = useState<InitialMeta | null>(null);
    const [, setInitialConfigOptions] = useState<ACPConfigOption[]>([]);
    const [, setAcpMcpStatuses] = useState<McpServerStatus[]>([]);
    const [, setQueuedCount] = useState(0);
    const engine = useEngineBase({ sessionId: active, initialMessages, initialMeta });
    refs.activeSessionIdRef.current = active; refs.sessionsRef.current = sessions;
    refs.messagesRef.current = engine.messages; refs.isProcessingRef.current = engine.isProcessing;
    const setters: Params["setters"] = { setActiveSessionId, setSessions, setInitialMessages, setInitialMeta, setInitialConfigOptions, setAcpMcpStatuses, setQueuedCount };
    const engines = { claude: engine, acp: engine, codex: engine, engine };
    const revival = useSessionRevival({ refs, setters, engines,
      findProject: () => ({ id: "fixture-project", name: "Fixture", path: "/fixture", createdAt: 1 }), getProjectCwd: () => "/fixture" });
    const queue = useMessageQueue({ refs, setters, engines, activeSessionId: active, reviveQueuedMessage: revival.reviveQueuedMessage });
    controller = { messages: engine.messages, processing: engine.isProcessing, navigate: (target) => {
      if (active) refs.backgroundStoreRef.current.initFromState(active, { messages: engine.messages, isProcessing: engine.isProcessing,
        isConnected: false, isCompacting: false, sessionInfo: null, totalCost: 3, contextUsage: null, pendingPermission: null, rawAcpPermission: null, slashCommands: [] });
      const background = refs.backgroundStoreRef.current.get(target);
      flushSync(() => {
        setInitialMessages(background?.messages ?? [target === id ? original : other]);
        setInitialMeta(background ?? null); setActiveSessionId(target);
      });
    } };
    const revive = engineId === "claude" ? revival.reviveSession : engineId === "codex" ? revival.reviveCodexSession : revival.reviveAcpSession;
    return <>
      <output data-active={active}>{engine.isProcessing ? "Processing" : "Ready"}</output>
      <button data-send onClick={() => { work = revive("Retained prompt", [{ id: "attachment", mediaType: "image/png", data: "Zml4dHVyZQ==" }]); }}>Send</button>
      {engine.messages.map((message) => <div key={message.id} data-message={message.id}>
        {message.content}
        {message.isQueued && <button data-retry={message.id} onClick={() => { work = queue.sendQueuedMessageNext(message.id); }}>Send next</button>}
      </div>)}
    </>;
  }
  flushSync(() => root.render(<StrictMode><I18nProvider><Harness /></I18nProvider></StrictMode>));
  const click = (selector: string) => { const button = container.querySelector<HTMLButtonElement>(selector); assert(button, `Missing button ${selector}`); button.click(); };
  return { id, nextId, otherId, refs, counters, container, click,
    failSave: (value: boolean) => { saveFails = value; },
    holdStart: () => { startGate = deferred<void>(); return () => startGate?.resolve(); },
    holdSend: () => { sendGate = deferred<{ ok: true }>(); return () => sendGate?.resolve({ ok: true }); },
    navigate: (target: string) => controller.navigate(target),
    wait: () => work,
    state: () => controller,
    sentImages: () => lastSentImages,
    unmount: () => { flushSync(() => root.unmount()); container.remove(); },
  };
}

async function runSessionRecoveryChecks(): Promise<string[]> {
  const results: string[] = [];
  for (const engine of ["claude", "codex", "acp"] as const) {
    let f = fixture(engine);
    try {
      f.failSave(true); f.click("[data-send]"); await f.wait();
      await waitFor(() => !!f.container.querySelector("[data-retry]"));
      const queuedId = f.refs.messageQueueRef.current.get(f.id)?.[0]?.messageId;
      assert(queuedId && !f.state().processing, `${engine}: failed save did not retain an idle queue`);
      f.failSave(false); const release = f.holdStart(); const finishTurn = f.holdSend();
      f.click("[data-retry]"); const retry = f.wait(); f.click("[data-retry]");
      release(); await waitFor(() => f.counters.sends === 1);
      assert(!isSessionRecovering(f.nextId), `${engine}: running turn blocks saves and exports`);
      finishTurn(); await retry;
      await waitFor(() => f.refs.activeSessionIdRef.current === f.nextId && !f.container.querySelector("[data-retry]"));
      assert(f.counters.starts === 2 && f.counters.sends === 1, `${engine}: retry started or sent twice`);
      assert(f.state().messages.filter((m) => m.content === "Retained prompt").length === 1, `${engine}: duplicate prompt`);
      assert(f.state().messages.some((m) => m.id === queuedId && !m.isQueued), `${engine}: retry lost original message identity`);
      assert(JSON.stringify(f.sentImages()).includes("Zml4dHVyZQ=="), `${engine}: retry dropped the image`);
      results.push(`${engine}: failed save, DOM retry, repeated clicks and actual engine reset passed`);
    } finally { f.unmount(); }

    f = fixture(engine);
    try {
      const release = f.holdStart(); f.click("[data-send]");
      await waitFor(() => f.counters.starts === 1);
      f.navigate(f.otherId); await sleep(); f.navigate(f.id); await sleep();
      release(); await f.wait();
      assert(f.counters.sends === 0 && f.counters.saves === 0 && f.counters.stops === 1, `${engine}: navigation away and back failed to cancel startup`);
      assert(f.refs.activeSessionIdRef.current === f.id, `${engine}: stale result replaced the view`);
      assert(f.refs.messageQueueRef.current.get(f.id)?.length === 1, `${engine}: cancellation lost queued input`);
      results.push(`${engine}: navigation away and back cancels late startup`);
    } finally { f.unmount(); }

    f = fixture(engine);
    const release = f.holdStart(); f.click("[data-send]"); await waitFor(() => f.counters.starts === 1);
    f.unmount(); release(); await f.wait();
    assert(f.counters.sends === 0 && f.counters.saves === 0 && f.counters.stops === 1, `${engine}: unmounted pane accepted a late runtime`);
    results.push(`${engine}: unmount disposes a late runtime without sending`);
  }
  const f = fixture("claude", true);
  try {
    f.click("[data-send]"); await f.wait(); await sleep();
    assert(f.counters.sends === 1 && f.refs.activeSessionIdRef.current === f.id, "Same-ID Claude restore failed");
    assert(f.state().messages.some((m) => m.content === "Retained prompt" && !m.isQueued), "Same-ID restore lost its prompt");
    results.push("claude: same runtime ID remains usable");
  } finally { f.unmount(); }
  return results;
}

Object.assign(window, { runSessionRecoveryChecks });
