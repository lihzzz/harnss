import type { ThreadGoal } from "../types/codex-protocol/v2/ThreadGoal";
import type { ThreadGoalStatus } from "../types/codex-protocol/v2/ThreadGoalStatus";

export const THREAD_GOAL_STATUSES: readonly ThreadGoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "usageLimited",
  "budgetLimited",
  "complete",
];

const statusSet = new Set<string>(THREAD_GOAL_STATUSES);

export function isThreadGoalStatus(value: unknown): value is ThreadGoalStatus {
  return typeof value === "string" && statusSet.has(value);
}

export function parseThreadGoal(value: unknown): ThreadGoal | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const isFiniteNumber = (entry: unknown): entry is number => typeof entry === "number" && Number.isFinite(entry);
  if (
    typeof record.threadId !== "string" ||
    typeof record.objective !== "string" ||
    !isThreadGoalStatus(record.status) ||
    (record.tokenBudget !== null && (!isFiniteNumber(record.tokenBudget) || !Number.isInteger(record.tokenBudget) || record.tokenBudget <= 0)) ||
    !isFiniteNumber(record.tokensUsed) || record.tokensUsed < 0 ||
    !isFiniteNumber(record.timeUsedSeconds) || record.timeUsedSeconds < 0 ||
    !isFiniteNumber(record.createdAt) || record.createdAt < 0 ||
    !isFiniteNumber(record.updatedAt) || record.updatedAt < 0
  ) {
    return null;
  }
  return {
    threadId: record.threadId,
    objective: record.objective,
    status: record.status,
    tokenBudget: record.tokenBudget,
    tokensUsed: record.tokensUsed,
    timeUsedSeconds: record.timeUsedSeconds,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function isMethodNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === -32601) {
    return true;
  }
  return /(?:RPC error|error)\s*\[?-32601\]?|method not found/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

export interface GoalNotificationTransition {
  kind: "none" | "completed" | "blocked" | "limited" | "paused" | "resumed";
  key: string | null;
}

export function getGoalNotificationTransition(
  previous: ThreadGoal | null | undefined,
  current: ThreadGoal | null | undefined,
): GoalNotificationTransition {
  if (!current) return { kind: "none", key: null };
  const key = `${current.threadId}:${current.updatedAt}:${current.status}`;
  if (previous && previous.status === current.status) {
    return { kind: "none", key };
  }
  if (current.status === "complete") return { kind: "completed", key };
  if (current.status === "blocked") return { kind: "blocked", key };
  if (current.status === "usageLimited" || current.status === "budgetLimited") {
    return { kind: "limited", key };
  }
  if (current.status === "paused") return { kind: "paused", key };
  if (current.status === "active" && previous?.status === "paused") {
    return { kind: "resumed", key };
  }
  return { kind: "none", key };
}

export interface GoalState {
  goal: ThreadGoal | null;
  supported: boolean | null;
  error: string | null;
}

export function reduceGoalEvent(
  state: GoalState,
  event:
    | { type: "updated"; goal: unknown }
    | { type: "cleared" }
    | { type: "support"; supported: boolean }
    | { type: "error"; error: string },
): GoalState {
  switch (event.type) {
    case "updated": {
      const goal = parseThreadGoal(event.goal);
      if (!goal) return state;
      if (state.goal && state.goal.threadId === goal.threadId && state.goal.updatedAt > goal.updatedAt) {
        return state;
      }
      return { goal, supported: true, error: null };
    }
    case "cleared":
      return { ...state, goal: null, error: null };
    case "support":
      return { ...state, supported: event.supported, error: null };
    case "error":
      return { ...state, error: event.error };
  }
}
