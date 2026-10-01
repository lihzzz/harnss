import { useEffect, useState } from "react";
import { Pause, Play, Target, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CodexThreadGoal } from "@/types";
import { CodexGoalStatus } from "./CodexGoalStatus";

interface CodexGoalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goal: CodexThreadGoal | null;
  loading?: boolean;
  error?: string | null;
  onSave: (input: { objective: string; tokenBudget: number | null }) => Promise<boolean>;
  onPause: () => Promise<boolean>;
  onResume: () => Promise<boolean>;
  onClear: () => Promise<boolean>;
}

export function CodexGoalDialog({ open, onOpenChange, goal, loading = false, error, onSave, onPause, onResume, onClear }: CodexGoalDialogProps) {
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState(goal?.tokenBudget?.toString() ?? "");

  useEffect(() => {
    if (!open) return;
    setObjective(goal?.objective ?? "");
    setTokenBudget(goal?.tokenBudget?.toString() ?? "");
  }, [goal, open]);

  const save = async () => {
    const trimmed = objective.trim();
    if (!trimmed) return;
    const budget = tokenBudget.trim() ? Number(tokenBudget) : null;
    if (budget !== null && (!Number.isInteger(budget) || budget <= 0)) return;
    if (await onSave({ objective: trimmed, tokenBudget: budget })) onOpenChange(false);
  };

  const mutate = async (operation: () => Promise<boolean>) => {
    await operation();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Target className="size-4" /> Codex Goal</DialogTitle>
          <DialogDescription>A persistent objective owned by the Codex app-server.</DialogDescription>
        </DialogHeader>

        {goal && <CodexGoalStatus goal={goal} />}
        <div className="space-y-3">
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Objective</span>
            <textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={4} className="flex w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Describe the outcome Codex should pursue" />
          </label>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium">Token budget <span className="font-normal text-muted-foreground">(optional)</span></span>
            <Input inputMode="numeric" value={tokenBudget} onChange={(event) => setTokenBudget(event.target.value.replace(/[^0-9]/g, ""))} placeholder="Unlimited" />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          {goal && <Button type="button" variant="ghost" className="me-auto text-destructive hover:text-destructive" disabled={loading} onClick={() => void mutate(onClear)}><Trash2 className="size-3.5" /> Clear</Button>}
          {goal?.status === "active" && <Button type="button" variant="outline" disabled={loading} onClick={() => void mutate(onPause)}><Pause className="size-3.5" /> Pause</Button>}
          {goal?.status === "paused" && <Button type="button" variant="outline" disabled={loading} onClick={() => void mutate(onResume)}><Play className="size-3.5" /> Resume</Button>}
          <Button type="button" disabled={loading || !objective.trim()} onClick={() => void save()}>{goal ? "Save changes" : "Start Goal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
