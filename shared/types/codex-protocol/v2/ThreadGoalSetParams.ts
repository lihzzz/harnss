// Generated from the Codex app-server protocol (codex-cli 0.159.2).
import type { ThreadGoalStatus } from "./ThreadGoalStatus";

export type ThreadGoalSetParams = {
  threadId: string;
  objective?: string | null;
  status?: ThreadGoalStatus | null;
  tokenBudget?: number | null;
};
