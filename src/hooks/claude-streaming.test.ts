import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetStateAction } from "react";
import type { AssistantMessageEvent, ClaudeEvent, StreamEvent, UIMessage } from "@/types";
import { BackgroundSessionStore } from "@/lib/background/session-store";
import { useClaude } from "./useClaude";

const lifecycle = vi.hoisted(() => ({
  effects: [] as Array<() => void | (() => void)>,
  cleanups: [] as Array<() => void>,
}));

// Run the real event handlers, buffer and frame scheduler without a DOM.
// State updaters run synchronously; this harness does not simulate React renders.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: <T,>(initial: T) => {
    let value = initial;
    return [value, (update: SetStateAction<T>) => {
      value = typeof update === "function"
        ? (update as (previous: T) => T)(value)
        : update;
    }];
  },
  useRef: <T,>(current: T) => ({ current }),
  useCallback: <T,>(callback: T) => callback,
  useEffect: (effect: () => void | (() => void)) => lifecycle.effects.push(effect),
}));

vi.mock("@/lib/analytics/analytics", () => ({ capture: vi.fn() }));

const sessionId = "claude-streaming-session";
const message = { model: "claude", id: "sdk-message", role: "assistant" as const };

interface StreamDriver {
  emit: (event: ClaudeEvent) => void;
  messages: () => UIMessage[];
}

function createForegroundDriver(): StreamDriver {
  let onEvent: (event: ClaudeEvent) => void = () => { throw new Error("Not subscribed"); };
  vi.stubGlobal("window", { claude: {
    log: vi.fn(),
    onEvent: (handler: typeof onEvent) => { onEvent = handler; return vi.fn(); },
    onPermissionRequest: () => vi.fn(),
    onExit: () => vi.fn(),
  } });
  const hook = useClaude({ sessionId });
  for (const effect of lifecycle.effects) {
    const cleanup = effect();
    if (cleanup) lifecycle.cleanups.push(cleanup);
  }
  return {
    emit: (event) => onEvent(event),
    messages: () => {
      let messages: UIMessage[] = [];
      hook.setMessages((current) => { messages = current; return current; });
      return messages;
    },
  };
}

function createBackgroundDriver(): StreamDriver {
  const store = new BackgroundSessionStore();
  return {
    emit: (event) => store.handleEvent({ ...event, _sessionId: sessionId }),
    messages: () => store.get(sessionId)?.messages ?? [],
  };
}

function stream(driver: StreamDriver, event: StreamEvent["event"]): void {
  driver.emit({ type: "stream_event", session_id: sessionId, event });
}

function snapshot(driver: StreamDriver, content: AssistantMessageEvent["message"]["content"]): void {
  driver.emit({
    type: "assistant", session_id: sessionId, uuid: "snapshot",
    message: { ...message, content },
  });
}

beforeEach(() => {
  lifecycle.effects = [];
  lifecycle.cleanups = [];
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});

afterEach(() => {
  for (const cleanup of lifecycle.cleanups) cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([
  ["foreground", createForegroundDriver],
  ["background", createBackgroundDriver],
] as const)("Claude %s streaming", (_name, createDriver) => {
  it("displays text after an empty thinking snapshot before completion or interruption", () => {
    const driver = createDriver();
    stream(driver, { type: "message_start", message });
    const id = driver.messages()[0].id;
    stream(driver, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } });
    stream(driver, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } });
    snapshot(driver, [{ type: "thinking", thinking: "" }]);
    stream(driver, { type: "content_block_stop", index: 0 });
    stream(driver, { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });

    for (const text of ["第一段", "\n第二段"]) {
      stream(driver, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } });
      vi.advanceTimersByTime(16);
      expect(driver.messages()).toEqual([
        expect.objectContaining({ id, content: expect.stringContaining(text), isStreaming: true }),
      ]);
    }

    snapshot(driver, [{ type: "text", text: "第一段\n第二段" }]);
    stream(driver, { type: "message_delta", delta: { stop_reason: "end_turn" } });
    stream(driver, { type: "message_stop" });
    expect(driver.messages()).toEqual([
      expect.objectContaining({ id, content: "第一段\n第二段", isStreaming: false }),
    ]);
  });

  it("keeps an empty placeholder until a tool-only message actually ends", () => {
    const driver = createDriver();
    stream(driver, { type: "message_start", message });
    snapshot(driver, [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "README.md" } }]);
    expect(driver.messages().some((entry) => entry.role === "assistant" && entry.isStreaming)).toBe(true);

    stream(driver, { type: "message_delta", delta: { stop_reason: "tool_use" } });
    stream(driver, { type: "message_stop" });
    expect(driver.messages()).toEqual([
      expect.objectContaining({ role: "tool_call", toolName: "Read" }),
    ]);
  });
});
