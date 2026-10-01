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
});
