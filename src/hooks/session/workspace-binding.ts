import type { WorkspaceBinding } from "@shared/types/workspace";
import type { Project } from "@/types/session";

/** Resolve fixed application targets in main; the selected worktree is only a legacy fallback. */
export async function resolveSessionCwd(
  project: Project,
  binding: WorkspaceBinding | undefined,
  getProjectCwd: (project: Project) => string,
): Promise<string> {
  if (!binding) return getProjectCwd(project);
  if (binding.projectId !== project.id) throw new Error("The conversation workspace belongs to a different project.");
  const result = await window.claude.projectApps.validateWorkspace(binding);
  if (!result.ok) throw new Error(result.error.message);
  return result.value.cwd;
}
