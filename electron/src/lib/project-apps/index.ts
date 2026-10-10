import path from "node:path";
import { getDataDir } from "../data-dir";
import { readProjectCatalog } from "../project-catalog";
import { getSessionRepository } from "../session-service";
import { readSpaces } from "../../ipc/spaces";
import { reportError } from "../error-utils";
import { ProjectAppsService } from "./service";

let instance: ProjectAppsService | null = null;
export function getProjectAppsService(): ProjectAppsService {
  if (!instance) instance = new ProjectAppsService({ root: path.join(getDataDir(), "project-apps"),
    projects: () => readProjectCatalog(getDataDir(), true), spaces: () => (readSpaces(true) ?? [{ id: "default" }]).map((space) => space.id),
    initialize: () => getSessionRepository().initialize(), projectBlocked: (id) => getSessionRepository().isProjectBlocked(id),
    bindRuntime: (projectId, runId, stop) => getSessionRepository().bindProjectRuntime(projectId, runId, stop),
    report: (error) => { reportError("PROJECT_APPS", error); } });
  return instance;
}
export { ProjectAppsService } from "./service";
