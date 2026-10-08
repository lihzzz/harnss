import { describe, expect, it } from "vitest";
import { handleCodexEvent } from "./codex-handler";
import type { InternalState } from "./session-store";

function state(): InternalState {
  return {
    messages: [], isProcessing: false, isConnected: false, isCompacting: false,
    sessionInfo: null, totalCost: 0, contextUsage: null, pendingPermission: null,
    rawAcpPermission: null, slashCommands: [], codexGoal: null, codexGoalSupported: null,
    parentToolMap: new Map(), currentStreamingMsgId: null, codexPlanText: "",
    codexPlanTurnCounter: 0, activeTask: null,
  };
}

const goal = {
  threadId: "thread-1", objective: "Ship it", status: "active" as const,
  tokenBudget: 100, tokensUsed: 0, timeUsedSeconds: 0, createdAt: 1, updatedAt: 1,
};

describe("background Codex Goal handling", () => {
  it("keeps newer snapshots and clears independently from turns", () => {
    const current = state();
    const event = (goalValue: typeof goal) => ({
      _sessionId: "session-1", method: "thread/goal/updated" as const,
      params: { threadId: goalValue.threadId, turnId: null, goal: goalValue },
    });
    handleCodexEvent(current, event(goal));
    handleCodexEvent(current, event({ ...goal, updatedAt: 0, objective: "stale" }));
    expect(current.codexGoal?.objective).toBe("Ship it");
    const result = handleCodexEvent(current, {
      _sessionId: "session-1", method: "thread/goal/cleared", params: { threadId: goal.threadId },
    });
    expect(result?.goalChanged).toBe(true);
    expect(current.codexGoal).toBeNull();
  });

  it("surfaces failed turns and final server errors as retryable messages", () => {
    const current = state();
    const failedTurn = handleCodexEvent(current, {
      _sessionId: "session-1",
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", items: [], status: "failed", error: { message: "Upstream timed out", codexErrorInfo: null, additionalDetails: null } },
      },
    });
    expect(failedTurn?.processingChanged).toBe(true);
    expect(current.messages.at(-1)?.retryable).toBe(true);

    handleCodexEvent(current, {
      _sessionId: "session-1",
      method: "error",
      params: {
        error: { message: "401 Unauthorized", codexErrorInfo: null, additionalDetails: null },
        willRetry: false,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });
    expect(current.messages.at(-1)?.retryable).toBeFalsy();
  });

  it("does not surface errors while Codex is retrying upstream", () => {
    const current = state();
    const result = handleCodexEvent(current, {
      _sessionId: "session-1",
      method: "error",
      params: {
        error: { message: "Temporary upstream error", codexErrorInfo: null, additionalDetails: null },
        willRetry: true,
        threadId: "thread-1",
        turnId: "turn-1",
      },
    });
    expect(result).toBeUndefined();
    expect(current.messages).toHaveLength(0);
    expect(current.isProcessing).toBe(false);
  });
});
