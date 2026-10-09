import { describe, expect, it } from "vitest";
import type { UIMessage } from "@/types";
import { formatCompactSummary } from "./tool-formatting";

describe("formatCompactSummary", () => {
  it("shortens Windows tool input paths and result paths consistently", () => {
    const message: UIMessage = { id: "read-win", role: "tool_call", content: "", toolName: "Read", timestamp: 0 };
    expect(formatCompactSummary({ ...message, toolInput: { file_path: "C:\\项目\\src\\a.ts" } })).toBe("a.ts");
    expect(formatCompactSummary({ ...message, toolResult: { filePath: "\\\\server\\share\\中文.ts" } })).toBe("中文.ts");
  });
  it("does not report Claude multi-hunk single-file edits as multiple files", () => {
    const message: UIMessage = {
      id: "edit-1",
      role: "tool_call",
      content: "",
      toolName: "Edit",
      toolInput: {
        file_path: "/repo/src/LtiTeacherAssignmentPreview.tsx",
        old_string: "old",
        new_string: "new",
        replace_all: false,
      },
      toolResult: {
        filePath: "/repo/src/LtiTeacherAssignmentPreview.tsx",
        oldString: "old",
        newString: "new",
        structuredPatch: [
          { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] },
          { oldStart: 20, oldLines: 1, newStart: 20, newLines: 1, lines: ["-old2", "+new2"] },
        ],
      },
      timestamp: 0,
    };

    expect(formatCompactSummary(message)).toBe("LtiTeacherAssignmentPreview.tsx");
  });
});
