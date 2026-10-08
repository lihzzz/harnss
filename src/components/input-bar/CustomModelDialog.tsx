import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface CustomModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Currently stored custom model ID ("" when unset) */
  value: string;
  placeholder?: string;
  onSave: (modelId: string) => void;
  onClear: () => void;
}

/** Dialog for entering a custom model ID for the current engine. */
export function CustomModelDialog({
  open,
  onOpenChange,
  value,
  placeholder,
  onSave,
  onClear,
}: CustomModelDialogProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const trimmed = draft.trim();

  const save = () => {
    if (!trimmed) return;
    onSave(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Custom Model ID</DialogTitle>
          <DialogDescription>
            Use a model that isn&apos;t in the list. The ID is saved for this
            engine and stays available when you switch models.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder ?? "model-id"}
            className="font-mono"
            spellCheck={false}
          />
          <DialogFooter className="mt-4">
            {value && (
              <Button
                type="button"
                variant="ghost"
                className="me-auto text-destructive hover:text-destructive"
                onClick={() => {
                  onClear();
                  onOpenChange(false);
                }}
              >
                Remove
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!trimmed}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
