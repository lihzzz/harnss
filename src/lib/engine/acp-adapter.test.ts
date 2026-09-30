import { describe, expect, it } from "vitest";
import { deriveToolName, normalizeToolInput } from "./acp-adapter";

describe("ACP OpenCode tool compatibility", () => {
  it("normalizes OpenCode tool titles when ACP omits kind", () => {
    expect(deriveToolName("bash")).toBe("Bash");
    expect(deriveToolName("read_file")).toBe("Read");
    expect(deriveToolName("apply_patch")).toBe("Edit");
    expect(deriveToolName("question")).toBe("AskUserQuestion");
  });

  it("normalizes OpenCode tool titles when kind is other", () => {
    expect(deriveToolName("grep", "other")).toBe("Grep");
    expect(deriveToolName("glob", "other")).toBe("Glob");
    expect(deriveToolName("todowrite", "other")).toBe("TodoWrite");
  });

  it("accepts OpenCode camelCase edit fields", () => {
    expect(normalizeToolInput(
      {
        filePath: "src/example.ts",
        oldString: "before",
        newString: "after",
      },
      "edit",
    )).toEqual({
      file_path: "src/example.ts",
      old_string: "before",
      new_string: "after",
    });
  });
});
