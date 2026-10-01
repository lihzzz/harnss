import { Clock3, Coins, Target } from "lucide-react";
import type { CodexThreadGoal } from "@/types";
import { CodexGoalBadge } from "./CodexGoalBadge";

function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)}s`;
  const minutes = Math.floor(value / 60);
  return `${minutes}m ${Math.round(value % 60)}s`;
}

export function CodexGoalStatus({ goal }: { goal: CodexThreadGoal }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <CodexGoalBadge goal={goal} />
      <span className="flex min-w-0 items-center gap-1 truncate text-[11px] text-muted-foreground" title={goal.objective}>
        <Target className="size-3 shrink-0" />
        <span className="truncate">{goal.objective}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-[10px] text-muted-foreground/70 sm:inline-flex">
        <Coins className="size-3" />{goal.tokensUsed}{goal.tokenBudget ? `/${goal.tokenBudget}` : ""}
        <Clock3 className="ms-1 size-3" />{formatSeconds(goal.timeUsedSeconds)}
      </span>
    </div>
  );
}
