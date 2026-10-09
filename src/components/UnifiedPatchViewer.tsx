import { memo, useMemo, useState } from "react";
import { ChevronsUpDown } from "lucide-react";
import { OpenInEditorButton } from "./OpenInEditorButton";
import { getFileName } from "@shared/lib/file-paths";

interface UnifiedPatchViewerProps {
  diffText: string;
  filePath?: string;
}

const MAX_PATCH_LINES = 100;

function getLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-(--diff-note-fg)";
  if (line.startsWith("+")) return "text-(--diff-add-fg) bg-(--diff-add-bg)";
  if (line.startsWith("-")) return "text-(--diff-remove-fg) bg-(--diff-remove-bg)";
  if (
    line.startsWith("diff --git ")
    || line.startsWith("index ")
    || line.startsWith("--- ")
    || line.startsWith("+++ ")
  ) {
    return "text-foreground/55 dark:text-foreground/45";
  }
  if (line.startsWith("\\ No newline at end of file")) return "text-foreground/40 dark:text-foreground/30 italic";
  return "text-foreground/85 dark:text-foreground/60";
}

export const UnifiedPatchViewer = memo(function UnifiedPatchViewer({
  diffText,
  filePath,
}: UnifiedPatchViewerProps) {
  const lines = useMemo(() => diffText.replace(/\r\n/g, "\n").split("\n"), [diffText]);
  const fileName = filePath ? getFileName(filePath) : null;
  const [expanded, setExpanded] = useState(false);

  const totalLines = lines.length;
  const isTruncated = !expanded && totalLines > MAX_PATCH_LINES;
  const displayLines = isTruncated ? lines.slice(0, MAX_PATCH_LINES) : lines;

  return (
    <div className="rounded-lg border border-border/50 overflow-hidden font-mono text-[12px] leading-[1.55] bg-muted/55 dark:bg-foreground/[0.06]">
      {fileName && (
        <div className="group/diff flex items-center gap-3 px-3 py-1.5 bg-muted/70 dark:bg-foreground/[0.04] border-b border-border/40">
          <span className="text-foreground/80 truncate flex-1">{fileName}</span>
          {filePath ? <OpenInEditorButton filePath={filePath} className="group-hover/diff:text-foreground/25" /> : null}
        </div>
      )}
      <div className="max-h-[28rem] overflow-auto px-3 py-2">
        {displayLines.map((line, idx) => (
          <div
            key={`${idx}-${line.length}`}
            className={`whitespace-pre-wrap wrap-break-word ${getLineClass(line)}`}
          >
            {line || " "}
          </div>
        ))}
        {(isTruncated || (expanded && totalLines > MAX_PATCH_LINES)) && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 flex items-center gap-1 text-[10px] font-medium text-foreground/40 hover:text-foreground/70 transition-colors"
          >
            <ChevronsUpDown className="h-3 w-3" />
            {expanded ? "Collapse" : `Show all ${totalLines} lines`}
          </button>
        )}
      </div>
    </div>
  );
});
