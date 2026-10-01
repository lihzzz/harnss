import { describe, expect, it } from "vitest";
import {
  getGoalNotificationTransition,
  isMethodNotFoundError,
  parseThreadGoal,
  reduceGoalEvent,
} from "./codex-goal";
import type { GoalState } from "./codex-goal";

const goal = {
  threadId: "thread-1",
  objective: "Ship it",
  status: "active" as const,
  tokenBudget: 100,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 1,
};

describe("codex goal protocol helpers", () => {
  it("parses complete goals and rejects malformed values", () => {
    expect(parseThreadGoal(goal)).toEqual(goal);
    expect(parseThreadGoal({ ...goal, status: "unknown" })).toBeNull();
    expect(parseThreadGoal({ ...goal, tokensUsed: "0" })).toBeNull();
  });

  it("drops stale updates and handles clear events", () => {
    let state: GoalState = { goal: null, supported: null, error: null };
    state = reduceGoalEvent(state, { type: "updated", goal });
    state = reduceGoalEvent(state, { type: "updated", goal: { ...goal, updatedAt: 0 } });
    expect(state.goal?.updatedAt).toBe(1);
    state = reduceGoalEvent(state, { type: "cleared" });
    expect(state.goal).toBeNull();
  });

  it("classifies terminal transitions and de-duplicates unchanged snapshots", () => {
    expect(getGoalNotificationTransition(null, goal).kind).toBe("none");
    expect(getGoalNotificationTransition(goal, { ...goal, status: "complete", updatedAt: 2 }).kind).toBe("completed");
    expect(getGoalNotificationTransition(goal, { ...goal, updatedAt: 1 }).kind).toBe("none");
    expect(getGoalNotificationTransition(goal, { ...goal, updatedAt: 2 }).kind).toBe("none");
    expect(getGoalNotificationTransition(goal, { ...goal, status: "budgetLimited", updatedAt: 2 }).kind).toBe("limited");
  });

  it("recognizes method-not-found errors", () => {
    expect(isMethodNotFoundError(new Error("Codex RPC error [-32601]: method not found"))).toBe(true);
    expect(isMethodNotFoundError(new Error("network timeout"))).toBe(false);
  });
});
