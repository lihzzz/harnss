import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./unified-diff";

describe("parseUnifiedDiff", () => {
  it("tracks old and new line numbers across additions and deletions", () => {
    const lines = parseUnifiedDiff("@@ -3,3 +4,4 @@\n-old\n context\n+new\n tail");
    expect(lines.slice(1)).toEqual([
      { text: "-old", oldLine: 3, side: "old" },
      { text: " context", oldLine: 4, newLine: 4, side: "new" },
      { text: "+new", newLine: 5, side: "new" },
      { text: " tail", oldLine: 5, newLine: 6, side: "new" },
    ]);
  });
});
