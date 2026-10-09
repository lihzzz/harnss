import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { encodeClaudeProjectPath, getClaudeProjectDirectory } from "../claude-project-path";

describe("Claude project history directory", () => {
  it.each([
    ["C:\\Users\\name\\my project", "C--Users-name-my-project"],
    ["C:/Users/name/my project", "C--Users-name-my-project"],
    ["/Users/name/my_project.v2", "-Users-name-my-project-v2"],
    ["\\\\server\\share\\项目", "--server-share---"],
  ])("encodes %s like Claude CLI", (input, expected) => {
    expect(encodeClaudeProjectPath(input)).toBe(expected);
  });
  it("keeps long project names distinct using the CLI hash suffix", () => {
    const first = encodeClaudeProjectPath("/" + "a".repeat(210));
    const second = encodeClaudeProjectPath("/" + "a".repeat(209) + "b");
    expect(first).toMatch(/^-[a]{199}-[a-z0-9]+$/);
    expect(first).not.toBe(second);
  });

  describe("canonical project paths", () => {
    let directory: string;
    beforeAll(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-history-")); });
    afterAll(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

    it("resolves a project symlink before encoding the history key", () => {
      const project = path.join(directory, "actual project");
      const linkedProject = path.join(directory, "project link");
      fs.mkdirSync(project);
      fs.symlinkSync(project, linkedProject, process.platform === "win32" ? "junction" : "dir");
      const config = path.join(directory, "config");
      expect(getClaudeProjectDirectory(linkedProject, config))
        .toBe(getClaudeProjectDirectory(project, config));
    });

    it("normalizes decomposed Unicode in project and config paths like the CLI", () => {
      const project = path.join(directory, "cafe\u0301");
      fs.mkdirSync(project);
      const config = path.join(directory, "config-cafe\u0301");
      const expectedKey = encodeClaudeProjectPath(fs.realpathSync(project).normalize("NFC"));
      expect(getClaudeProjectDirectory(project, config))
        .toBe(path.join(config.normalize("NFC"), "projects", expectedKey));
    });

    it("falls back to a resolved normalized path when the project no longer exists", () => {
      const project = path.join(directory, "missing-cafe\u0301");
      const config = path.join(directory, "config");
      expect(getClaudeProjectDirectory(project, config))
        .toBe(path.join(config, "projects", encodeClaudeProjectPath(path.resolve(project).normalize("NFC"))));
    });
  });
});
