import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceBinding } from "@shared/types/workspace";
import { resolveSessionCwd } from "./workspace-binding";

const project = { id: "project", name: "Project", path: "/repo", createdAt: 1 };
const binding: WorkspaceBinding = { projectId: project.id, rootKind: "worktree", rootPath: "/worktrees/a",
  repoCommonDir: "/repo/.git", relativeCwd: "apps/web" };
afterEach(() => vi.unstubAllGlobals());

describe("fixed conversation workspace", () => {
  it("uses the main-process canonical directory without consulting the selected worktree", async () => {
    const validateWorkspace = vi.fn<Window["claude"]["projectApps"]["validateWorkspace"]>()
      .mockResolvedValue({ ok: true, value: { workspace: binding, cwd: "/worktrees/a/apps/web" } });
    vi.stubGlobal("window", { claude: { projectApps: { validateWorkspace } } });
    const selectedWorktree = vi.fn(() => "/worktrees/b");
    expect(await resolveSessionCwd(project, binding, selectedWorktree)).toBe("/worktrees/a/apps/web");
    expect(validateWorkspace).toHaveBeenCalledWith(binding);
    expect(selectedWorktree).not.toHaveBeenCalled();
  });

  it("fails when a bound worktree disappears instead of falling back to the main checkout", async () => {
    const validateWorkspace = vi.fn<Window["claude"]["projectApps"]["validateWorkspace"]>()
      .mockResolvedValue({ ok: false, error: { code: "TARGET_GONE", message: "Worktree was removed", retryable: false } });
    vi.stubGlobal("window", { claude: { projectApps: { validateWorkspace } } });
    const fallback = vi.fn(() => project.path);
    await expect(resolveSessionCwd(project, binding, fallback)).rejects.toThrow("Worktree was removed");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("rejects cross-project bindings before calling the host", async () => {
    await expect(resolveSessionCwd(project, { ...binding, projectId: "other" }, () => project.path))
      .rejects.toThrow("different project");
  });

  it("retains the existing selected-directory behavior for legacy conversations", async () => {
    expect(await resolveSessionCwd(project, undefined, () => "/worktrees/b")).toBe("/worktrees/b");
  });
});
