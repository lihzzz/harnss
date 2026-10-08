export function InlineDiff({ diff }: { diff: string }) {
  if (!diff || diff === "(no diff available)") {
    return (
      <div className="mb-1 border border-foreground/[0.06] bg-foreground/[0.02] px-3 py-1.5 text-[10px] text-foreground/35 italic">
        No diff available
      </div>
    );
  }
  const lines = diff.split("\n");
  const contentLines = lines.filter(
    (l) => !l.startsWith("diff ") && !l.startsWith("index ") && !l.startsWith("---") && !l.startsWith("+++") && !l.startsWith("\\"),
  );
  return (
    <div className="mb-1 max-h-56 overflow-auto border border-foreground/[0.06]">
      <pre className="font-mono text-[10px] leading-[1.6]">
        {contentLines.map((line, i) => {
          let textColor = "text-foreground/50";
          let bgColor = "";
          if (line.startsWith("+")) {
            textColor = "text-(--diff-add-fg)";
            bgColor = "bg-(--diff-add-bg)";
          } else if (line.startsWith("-")) {
            textColor = "text-(--diff-remove-fg)";
            bgColor = "bg-(--diff-remove-bg)";
          } else if (line.startsWith("@@")) {
            textColor = "text-(--diff-note-fg)";
            bgColor = "bg-blue-500/[0.06] dark:bg-blue-500/[0.04]";
          }
          return (
            <div key={i} className={`px-2.5 ${textColor} ${bgColor}`}>{line || " "}</div>
          );
        })}
      </pre>
    </div>
  );
}
