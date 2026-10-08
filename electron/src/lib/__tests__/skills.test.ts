import { describe, expect, it } from "vitest";
import { parseSkillFrontmatter } from "../skills";

describe("parseSkillFrontmatter", () => {
  it("extracts name and description from frontmatter", () => {
    const raw = [
      "---",
      "name: my-skill",
      "description: Does something useful.",
      "---",
      "",
      "# Body",
    ].join("\n");
    expect(parseSkillFrontmatter(raw)).toEqual({ name: "my-skill", description: "Does something useful." });
  });

  it("strips surrounding quotes from values", () => {
    const raw = ['---', 'name: "quoted"', "description: 'single'", "---"].join("\n");
    expect(parseSkillFrontmatter(raw)).toEqual({ name: "quoted", description: "single" });
  });

  it("returns empty object when frontmatter is missing", () => {
    expect(parseSkillFrontmatter("# Just markdown")).toEqual({});
  });

  it("handles CRLF line endings", () => {
    const raw = "---\r\nname: crlf\r\ndescription: windows style\r\n---\r\n";
    expect(parseSkillFrontmatter(raw)).toEqual({ name: "crlf", description: "windows style" });
  });

  it("ignores unrelated keys", () => {
    const raw = ["---", "license: MIT", "name: only-name", "---"].join("\n");
    expect(parseSkillFrontmatter(raw)).toEqual({ name: "only-name" });
  });
});
