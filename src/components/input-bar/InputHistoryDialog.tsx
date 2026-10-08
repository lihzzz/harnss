import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TOOLBAR_BTN } from "./constants";

interface InputHistoryDialogProps {
  history: string[];
}

export function InputHistoryDialog({ history }: InputHistoryDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={`${TOOLBAR_BTN} gap-1.5`}
          aria-label="Open input history"
        >
          <History className="size-3.5" />
          <span>Input history</span>
          {history.length > 0 && (
            <span className="text-[10px] text-muted-foreground/70">{history.length}</span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Input history</DialogTitle>
          <DialogDescription>
            Prompts sent in this session, from oldest to newest.
          </DialogDescription>
        </DialogHeader>
        {history.length > 0 ? (
          <ol className="max-h-[min(60vh,32rem)] space-y-2 overflow-y-auto pe-1">
            {history.map((prompt, index) => (
              <li
                key={`${index}-${prompt}`}
                className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              >
                <span className="me-2 text-xs text-muted-foreground/60">{index + 1}</span>
                {prompt}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No input history in this session.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
