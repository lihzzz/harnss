// Generated from the Codex app-server protocol (codex-cli 0.159.2).
import type { ThreadGoal } from "./ThreadGoal";

export type ThreadGoalUpdatedNotification = {
  threadId: string;
  turnId: string | null;
  goal: ThreadGoal;
};
