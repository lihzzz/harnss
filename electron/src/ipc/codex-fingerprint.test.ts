import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationHandler } from "../lib/codex-rpc";
import type { ReasoningEffort } from "@shared/types/codex-protocol/ReasoningEffort";
import type { CodexFingerprintProbeRequest, CodexFingerprintProbeResult } from "@shared/types/codex-fingerprint";
import { registerCodexFingerprintIpc } from "./codex-fingerprint";

type IpcHandler = (event: unknown, data: CodexFingerprintProbeRequest) => Promise<CodexFingerprintProbeResult | { error: string }>;
interface RpcParams {
  model?: string;
  threadId?: string;
  config?: { model_reasoning_effort: ReasoningEffort };
  effort?: ReasoningEffort;
}

const mocks = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: IpcHandler) => void>(),
  request: vi.fn<(method: string, params: RpcParams, notify: NotificationHandler | null) => Promise<unknown>>(),
  destroy: vi.fn(),
  returnedEffort: undefined as ReasoningEffort | undefined,
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "test" },
  ipcMain: { handle: mocks.handle },
}));
vi.mock("../lib/command-launch", () => ({ spawnExecutable: () => ({ pid: 123 }) }));
vi.mock("../lib/codex-binary", () => ({
  getCodexBinaryPath: async () => "codex",
  getCodexHome: () => "/tmp/harnss-fingerprint-test",
}));
vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/error-utils", () => ({
  reportError: (_label: string, error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("../lib/codex-rpc", () => ({
  CodexRpcClient: class {
    onNotification: NotificationHandler | null = null;
    isAlive = true;
    notify = vi.fn();
    destroy = mocks.destroy;
    request(method: string, params: RpcParams) {
      return mocks.request(method, params, this.onNotification);
    }
  },
}));

function invoke(data: CodexFingerprintProbeRequest) {
  return mocks.handle.mock.calls[0][1](undefined, data);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.returnedEffort = undefined;
  let threadCount = 0;
  mocks.request.mockImplementation(async (method, params, notify) => {
    if (method === "thread/start") {
      return {
        thread: { id: `thread-${++threadCount}`, path: null },
        model: params.model,
        reasoningEffort: mocks.returnedEffort ?? params.config?.model_reasoning_effort ?? "medium",
      };
    }
    if (method === "turn/start") {
      const turn = { id: `turn-${params.threadId}`, status: "completed" };
      notify?.({
        method: "item/completed",
        params: {
          threadId: params.threadId,
          item: {
            type: "agentMessage",
            phase: "final_answer",
            text: JSON.stringify(Array.from({ length: 300 }, (_, index) => index + 1)),
          },
        },
      });
      notify?.({ method: "turn/completed", params: { threadId: params.threadId, turn } });
      return { turn };
    }
    return {};
  });
  registerCodexFingerprintIpc();
});

describe("fingerprint probe reasoning effort", () => {
  it.each(["high", "none"] as const)("uses %s effort for all three samples", async (effort) => {
    const result = await invoke({ model: "gpt-test", effort });

    expect(result).toMatchObject({ selectedModel: "gpt-test", reasoningEffort: effort });
    const threads = mocks.request.mock.calls.filter(([method]) => method === "thread/start");
    const turns = mocks.request.mock.calls.filter(([method]) => method === "turn/start");
    expect(threads).toHaveLength(3);
    expect(turns).toHaveLength(3);
    for (const [, params] of threads) {
      expect(params).toMatchObject({ ephemeral: true, config: { model_reasoning_effort: effort } });
    }
    for (const [, params] of turns) {
      expect(params.effort).toBe(effort);
    }
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("keeps the server default when no effort is selected", async () => {
    const result = await invoke({ model: "gpt-test" });

    expect(result).toMatchObject({ reasoningEffort: "medium" });
    for (const [method, params] of mocks.request.mock.calls) {
      if (method === "thread/start") expect(params).not.toHaveProperty("config");
      if (method === "turn/start") expect(params).not.toHaveProperty("effort");
    }
  });

  it("reports an error if the server does not apply the selected effort", async () => {
    mocks.returnedEffort = "low";

    expect(await invoke({ model: "gpt-test", effort: "high" })).toEqual({
      error: "临时会话推理强度异常：请求 high，实际 low",
    });
    expect(mocks.request.mock.calls.some(([method]) => method === "turn/start")).toBe(false);
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });
});
