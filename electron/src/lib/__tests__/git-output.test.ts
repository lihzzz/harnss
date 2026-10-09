import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseGitPaths, parseGitStatus } from "../git-output";
import { listGitFiles } from "../git-exec";

describe("NUL-delimited Git output", () => {
  it("preserves quotes, newlines and leading/trailing whitespace", () => {
    expect(parseGitPaths(' 中文 文件 \0quote".txt\0line\nbreak\0')).toEqual([
      " 中文 文件 ", 'quote".txt', "line\nbreak",
    ]);
  });

  it("parses conflicts and branch metadata", () => {
    const raw = "# branch.head feature\0# branch.upstream origin/feature\0# branch.ab +2 -3\0"
      + "u UU N... 100644 100644 100644 100644 a b c conflict 文件.txt\0";
    expect(parseGitStatus(raw)).toEqual({
      branch: "feature", upstream: "origin/feature", ahead: 2, behind: 3,
      files: [{ path: "conflict 文件.txt", status: "unmerged", group: "unstaged" }],
    });
  });

  it("represents file type changes as modifications", () => {
    const raw = "1 T. N... 100644 120000 120000 a b changed-link\0";
    expect(parseGitStatus(raw).files).toEqual([
      { path: "changed-link", status: "modified", group: "staged" },
    ]);
  });

  describe("real temporary repository", () => {
    let directory: string;
    function git(...args: string[]): string {
      return execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
    }
    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-git-"));
      git("init", "--initial-branch=main");
      for (const name of ["原文件 name.txt", "同时修改.txt"]) fs.writeFileSync(path.join(directory, name), "original\n");
      git("add", "--", ".");
      git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
      git("mv", "--", "原文件 name.txt", "新文件 renamed.txt");
      fs.writeFileSync(path.join(directory, "同时修改.txt"), "staged\n");
      git("add", "--", "同时修改.txt");
      fs.appendFileSync(path.join(directory, "同时修改.txt"), "unstaged\n");
      fs.writeFileSync(path.join(directory, "未跟踪 file.txt"), "untracked\n");
      fs.mkdirSync(path.join(directory, "新目录 folder"));
      fs.writeFileSync(path.join(directory, "新目录 folder", "子文件 file.txt"), "nested untracked\n");
    });
    afterAll(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });
    it("lists Chinese and space-containing paths without Git quoting", async () => {
      expect(await listGitFiles(directory)).toEqual([
        "同时修改.txt", "新文件 renamed.txt", "未跟踪 file.txt", "新目录 folder/子文件 file.txt",
      ].sort());
    });
    it("retains both stages and the original rename path", () => {
      const status = parseGitStatus(git("status", "--porcelain=v2", "--branch", "--untracked-files=all", "-z"));
      expect(status.branch).toBe("main");
      expect(status.files).toEqual(expect.arrayContaining([
        { path: "同时修改.txt", status: "modified", group: "staged" },
        { path: "同时修改.txt", status: "modified", group: "unstaged" },
        { path: "新文件 renamed.txt", oldPath: "原文件 name.txt", status: "renamed", group: "staged" },
        { path: "未跟踪 file.txt", status: "untracked", group: "untracked" },
        { path: "新目录 folder/子文件 file.txt", status: "untracked", group: "untracked" },
      ]));
      expect(status.files).toHaveLength(5);
      // Discard uses ls-files to classify exact paths; status must not collapse
      // an untracked directory into a path that is absent from this list.
      const untracked = parseGitPaths(git("ls-files", "--others", "--exclude-standard", "-z"));
      expect(status.files.filter((file) => file.group === "untracked").map((file) => file.path).sort())
        .toEqual(untracked.sort());
    });
  });
});
