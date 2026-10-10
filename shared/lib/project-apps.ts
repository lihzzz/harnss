import type { AppCommand, AppLaunchProfile, ProjectAppInput } from "../types/project-apps";
import type { WorkspaceBinding } from "../types/workspace";

export class ProjectAppsValidationError extends Error {
  readonly code = "INVALID_ARGUMENT";
}
function isAppRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function appRecord(value: unknown): Record<string, unknown> {
  if (!isAppRecord(value)) throw new ProjectAppsValidationError("Expected an object");
  return value;
}
export function appString(value: unknown, label: string, max = 4096, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || value.length > max || value.includes("\0")) {
    throw new ProjectAppsValidationError(`Invalid ${label}`);
  }
  return value;
}
export function appId(value: unknown): string {
  const id = appString(value, "ID", 200);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ProjectAppsValidationError("Invalid ID");
  return id;
}
export function appNumber(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) throw new ProjectAppsValidationError(`Invalid ${label}`);
  return value;
}
export function appBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ProjectAppsValidationError(`Invalid ${label}`);
  return value;
}
export function appUrl(value: unknown): string {
  const text = appString(value, "URL", 8192);
  let url: URL;
  try { url = new URL(text); } catch { throw new ProjectAppsValidationError("Enter a complete http(s) URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new ProjectAppsValidationError("Only http(s) URLs without embedded credentials are supported");
  return url.href;
}
export function validateWorkspaceBinding(value: unknown): WorkspaceBinding {
  const input = appRecord(value);
  if (input.rootKind !== "project" && input.rootKind !== "worktree") throw new ProjectAppsValidationError("Invalid workspace kind");
  const relativeCwd = appString(input.relativeCwd, "relative directory", 4096, true);
  if (/^(?:[a-zA-Z]:|[\\/])/.test(relativeCwd) || relativeCwd.split(/[\\/]/).includes("..")) throw new ProjectAppsValidationError("The working directory must be relative and stay inside the workspace");
  return { projectId: appId(input.projectId), rootKind: input.rootKind, rootPath: appString(input.rootPath, "workspace path"),
    repoCommonDir: input.repoCommonDir === null ? null : appString(input.repoCommonDir, "repository identity"), relativeCwd };
}
function commandArgs(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 128) throw new ProjectAppsValidationError("Invalid command arguments");
  return value.map((argument) => appString(argument, "argument", 8192, true));
}
export function validateAppCommand(value: unknown): AppCommand {
  const input = appRecord(value);
  if (input.kind === "executable") return { kind: "executable", executable: appString(input.executable, "executable"), args: commandArgs(input.args) };
  if (input.kind !== "package-script" || (input.manager !== "pnpm" && input.manager !== "npm" && input.manager !== "yarn" && input.manager !== "bun")) throw new ProjectAppsValidationError("Invalid command type or package manager");
  const script = appString(input.script, "script", 200);
  if (script.startsWith("-") || /[\r\n]/.test(script)) throw new ProjectAppsValidationError("Invalid package script name");
  return { kind: "package-script", manager: input.manager, script, args: commandArgs(input.args) };
}
export function validateLaunchProfile(value: unknown): AppLaunchProfile {
  const input = appRecord(value);
  if (input.adapter !== "generic" && input.adapter !== "vite" && input.adapter !== "next") throw new ProjectAppsValidationError("Invalid framework adapter");
  const port = appRecord(input.port);
  const portPolicy = port.kind === "none" ? { kind: "none" as const }
    : port.kind === "fixed" ? { kind: "fixed" as const, port: appNumber(port.port, "port", 1, 65535) }
      : port.kind === "auto" ? { kind: "auto" as const, preferred: appNumber(port.preferred, "preferred port", 1024, 65535) } : null;
  if (!portPolicy || (portPolicy.kind === "auto" && input.adapter === "generic")) throw new ProjectAppsValidationError("Automatic ports require a supported framework adapter");
  const envInput = appRecord(input.env);
  if (Object.keys(envInput).length > 64) throw new ProjectAppsValidationError("Too many environment overrides");
  const env: Record<string, string> = {};
  for (const [key, val] of Object.entries(envInput)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || /(?:TOKEN|SECRET|PASSWORD|API_?KEY|PRIVATE_?KEY|CREDENTIAL)/i.test(key) || /^(?:ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_INSPECT_RESUME_ON_START)$/i.test(key)) throw new ProjectAppsValidationError(`Unsupported environment override: ${key}. Keep credentials in your project's environment configuration.`);
    env[key] = appString(val, "environment value", 8192, true);
  }
  const readiness = appRecord(input.readiness);
  let check: AppLaunchProfile["readiness"];
  if (readiness.kind === "process") check = { kind: "process" };
  else if (readiness.kind === "http" && Array.isArray(readiness.acceptedStatuses) && readiness.acceptedStatuses.length > 0 && readiness.acceptedStatuses.length <= 500) {
    const checkPath = appString(readiness.path, "health check path", 2048);
    if (!checkPath.startsWith("/") || checkPath.startsWith("//") || checkPath.includes("\\")) throw new ProjectAppsValidationError("Health check path must be origin-relative");
    check = { kind: "http", path: checkPath, acceptedStatuses: readiness.acceptedStatuses.map((status) => appNumber(status, "HTTP status", 100, 599)) };
  } else throw new ProjectAppsValidationError("Invalid readiness check");
  const previewUrl = appString(input.previewUrl, "preview URL", 8192, true);
  if (previewUrl) appUrl(previewUrl.replaceAll("{port}", "12345"));
  if (check.kind === "http" && !previewUrl) throw new ProjectAppsValidationError("HTTP readiness needs a preview URL");
  return { command: validateAppCommand(input.command), adapter: input.adapter, env, port: portPolicy, previewUrl, readiness: check,
    startupTimeoutMs: appNumber(input.startupTimeoutMs, "startup timeout", 1000, 600_000) };
}
export function validateProjectAppInput(value: unknown): ProjectAppInput {
  const input = appRecord(value);
  if (input.iconType !== "emoji" && input.iconType !== "lucide") throw new ProjectAppsValidationError("Invalid icon type");
  const presentation: Pick<ProjectAppInput, "name" | "icon" | "iconType" | "favorite" | "folder" | "order"> = { name: appString(input.name, "application name", 200).trim(), icon: appString(input.icon, "icon", 100), iconType: input.iconType,
    favorite: appBoolean(input.favorite, "favorite"), folder: appString(input.folder, "folder", 100, true), order: appNumber(input.order, "order", 0, 1_000_000) };
  if (input.kind === "web") return { ...presentation, kind: "web", spaceId: appId(input.spaceId), url: appUrl(input.url) };
  if (input.kind !== "managed") throw new ProjectAppsValidationError("Invalid application type");
  const projectId = appId(input.projectId);
  const workspace = validateWorkspaceBinding(input.workspace);
  if (workspace.projectId !== projectId) throw new ProjectAppsValidationError("Workspace belongs to another project");
  return { ...presentation, kind: "managed", projectId, workspace, launch: validateLaunchProfile(input.launch) };
}
