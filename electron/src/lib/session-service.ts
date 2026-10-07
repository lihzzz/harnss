import type { SessionMeta } from "@shared/lib/session-persistence";
import { getDataDir } from "./data-dir";
import { SessionRepository } from "./session-repository";
import { reportError } from "./error-utils";

let repository: SessionRepository | null = null;
export function getSessionRepository(): SessionRepository {
  const root = getDataDir();
  if (!repository || repository.root !== root) repository = new SessionRepository(root, reportError);
  return repository;
}

let stopRuntimes: (runtimeIds: string[], meta: SessionMeta) => Promise<void> = async () => {};
export function configureSessionStopper(stop: typeof stopRuntimes): void { stopRuntimes = stop; }
export function deleteConversation(projectId: string, runtimeId: string): Promise<"deleted" | "already_deleted"> {
  return getSessionRepository().remove(projectId, runtimeId, stopRuntimes);
}
export function deleteProject(projectId: string): Promise<"deleted" | "already_deleted"> {
  return getSessionRepository().removeProject(projectId, stopRuntimes);
}
