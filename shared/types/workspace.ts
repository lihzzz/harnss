/** A durable execution target, independent of the currently selected Space/worktree. */
export interface WorkspaceBinding {
  projectId: string;
  rootKind: "project" | "worktree";
  rootPath: string;
  repoCommonDir: string | null;
  relativeCwd: string;
}

export interface ProjectAppSessionOrigin {
  kind: "project-app";
  appId: string;
  runId: string | null;
}
