import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { WorkspaceBinding } from "@shared/types/workspace";
import { validateWorkspaceBinding } from "@shared/lib/project-apps";
import { ProductivityError } from "../productivity-errors";

export interface AppProject { id: string; path: string; spaceId?: string }
export function pathIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}
export function containsPath(root: string, child: string): boolean {
  const relative = path.relative(pathIdentity(root), pathIdentity(child));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function directory(value: string): Promise<string> {
  try {
    const canonical = await fs.realpath(value);
    if (!(await fs.stat(canonical)).isDirectory()) throw new Error("Not a directory");
    return canonical;
  } catch { throw new ProductivityError("TARGET_GONE", `Directory unavailable: ${value}`); }
}
export function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}
async function commonDirectory(root: string): Promise<string | null> {
  try {
    const common = (await runGit(["rev-parse", "--git-common-dir"], root)).trim();
    return await directory(path.resolve(root, common));
  } catch { return null; }
}
export async function listWorkspaces(project: AppProject): Promise<WorkspaceBinding[]> {
  const rootPath = await directory(project.path);
  const repoCommonDir = await commonDirectory(rootPath);
  const bindings: WorkspaceBinding[] = [{ projectId: project.id, rootKind: "project", rootPath, repoCommonDir, relativeCwd: "" }];
  if (!repoCommonDir) return bindings;
  const raw = await runGit(["worktree", "list", "--porcelain", "-z"], rootPath);
  for (const token of raw.split("\0")) {
    if (!token.startsWith("worktree ")) continue;
    try {
      const candidate = await directory(token.slice(9));
      if (pathIdentity(candidate) === pathIdentity(rootPath)) continue;
      const common = await commonDirectory(candidate);
      if (common && pathIdentity(common) === pathIdentity(repoCommonDir)) bindings.push({ projectId: project.id, rootKind: "worktree", rootPath: candidate, repoCommonDir, relativeCwd: "" });
    } catch { /* A stale/prunable worktree is not an executable target. */ }
  }
  return bindings;
}
export async function resolveWorkspace(project: AppProject, value: unknown): Promise<{ binding: WorkspaceBinding; cwd: string }> {
  const binding = validateWorkspaceBinding(value);
  if (binding.projectId !== project.id) throw new ProductivityError("INVALID_TARGET", "Workspace belongs to another project");
  const canonical = await directory(binding.rootPath);
  const available = await listWorkspaces(project);
  const match = available.find((item) => item.rootKind === binding.rootKind && pathIdentity(item.rootPath) === pathIdentity(canonical));
  if (!match) throw new ProductivityError("INVALID_TARGET", "The selected directory is no longer a workspace of this project");
  if (binding.repoCommonDir !== null && (!match.repoCommonDir || pathIdentity(binding.repoCommonDir) !== pathIdentity(match.repoCommonDir))) throw new ProductivityError("INVALID_TARGET", "The repository identity changed; select the workspace again");
  const cwd = await directory(path.resolve(match.rootPath, binding.relativeCwd || "."));
  if (!containsPath(match.rootPath, cwd)) throw new ProductivityError("INVALID_TARGET", "The working directory resolves outside the selected workspace");
  return { binding: { ...match, relativeCwd: path.relative(match.rootPath, cwd) }, cwd };
}
