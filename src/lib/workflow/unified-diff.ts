export interface ReviewableDiffLine {
  text: string;
  oldLine?: number;
  newLine?: number;
  side?: "old" | "new";
}

/** Adds real old/new file line numbers to a unified diff for line comments. */
export function parseUnifiedDiff(diff: string): ReviewableDiffLine[] {
  let oldLine: number | undefined;
  let newLine: number | undefined;

  return diff.split("\n").map((text) => {
    const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text };
    }

    if (oldLine === undefined || newLine === undefined || text.startsWith("\\")) {
      return { text };
    }
    if (text.startsWith("+")) {
      const line = { text, newLine, side: "new" as const };
      newLine += 1;
      return line;
    }
    if (text.startsWith("-")) {
      const line = { text, oldLine, side: "old" as const };
      oldLine += 1;
      return line;
    }
    const line = { text, oldLine, newLine, side: "new" as const };
    oldLine += 1;
    newLine += 1;
    return line;
  });
}
