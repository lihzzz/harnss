import { Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CodexThreadGoal } from "@/types";

const LABELS: Record<CodexThreadGoal["status"], string> = {
  active: "Goal active",
  paused: "Goal paused",
  blocked: "Goal blocked",
  usageLimited: "Usage limited",
  budgetLimited: "Budget limited",
  complete: "Goal complete",
};

export function CodexGoalBadge({ goal }: { goal: CodexThreadGoal }) {
  const tone = goal.status === "complete"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600"
    : goal.status === "blocked" || goal.status === "usageLimited" || goal.status === "budgetLimited"
      ? "border-amber-500/30 bg-amber-500/10 text-amber-600"
      : goal.status === "paused"
        ? "border-muted-foreground/30 bg-muted text-muted-foreground"
        : "border-blue-500/30 bg-blue-500/10 text-blue-600";
  return (
    <Badge variant="outline" className={`no-drag gap-1 text-[10px] ${tone}`}>
      <Target className="size-3" />
      {LABELS[goal.status]}
    </Badge>
  );
}
