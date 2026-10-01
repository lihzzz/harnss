// Generated from the Codex app-server protocol (codex-cli 0.159.2).
import type { ThreadGoalStatus } from "./ThreadGoalStatus";

export type ThreadGoal = {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
};
