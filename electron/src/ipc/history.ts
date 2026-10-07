import { app, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { HistoryLocation, OperationResult } from "@shared/types/productivity";
import { readProjects, onProjectsChanged } from "./projects";
import { readSpaces, onSpacesChanged } from "./spaces";
import { getDataDir } from "../lib/data-dir";
import { getSessionRepository } from "../lib/session-service";
import { assertMainRenderer, validateConversationTargets } from "../lib/productivity-ipc";
import { assertStorageId, failure, isRecord, ProductivityError } from "../lib/productivity-errors";
import { safeSend } from "../lib/safe-send";
import { reportError } from "../lib/error-utils";
import { HistoryService } from "../lib/history/service";
import { historyRequestId, validateHistoryActivity, validateHistorySearch, validateHistoryTimeline } from "../lib/history/validation";
import type { HistoryCatalog } from "../lib/history/types";
import type { HistoryWorkerCommand, HistoryWorkerValue } from "../lib/history/worker-protocol";
import { getAppSettings, setAppSettings } from "../lib/app-settings";
import { onSettingsChanged } from "./settings";

let service: HistoryService | null = null;
let unsubscribe: Array<() => void> = [];
function catalog(): HistoryCatalog {
  const projects = readProjects(true).filter((project) => !getSessionRepository().isProjectBlocked(project.id))
    .map((project) => ({ id: project.id, name: project.name, spaceId: project.spaceId || "default" }));
  const spaces = readSpaces(true)?.map((space) => ({ id: space.id, name: space.name })) ?? [{ id: "default", name: "General" }];
  return { projects, spaces };
}
export async function shutdownHistory(): Promise<void> { unsubscribe.forEach((off) => off()); unsubscribe = []; await service?.close(); service = null; }

export function register(getMainWindow: () => BrowserWindow | null): void {
  let invalidation = 0;
  const getService = () => service ??= new HistoryService(getDataDir(), catalog, (status) => safeSend(getMainWindow, "history:status-changed", status), () => getAppSettings().history);
  const refresh = () => {
    if (!service) return;
    void service.call({ action: "refresh" }).catch((error: unknown) => reportError("HISTORY:REFRESH", error));
  };
  const result = async (event: IpcMainInvokeEvent, task: () => Promise<HistoryWorkerValue>): Promise<OperationResult<HistoryWorkerValue>> => {
    try {
      assertMainRenderer(event, getMainWindow);
      await getSessionRepository().initialize();
      const revision = invalidation;
      const value = await task();
      if (revision !== invalidation) throw new ProductivityError("CURSOR_EXPIRED", "History changed while this request was running. Refresh the results.", true);
      if (value && "hits" in value && value.hits.some((hit) => getSessionRepository().isHistoryBlocked(hit.conversationKey))) throw new ProductivityError("CURSOR_EXPIRED", "A conversation was deleted. Refresh the results.", true);
      if (value && "items" in value && value.items.some((hit) => getSessionRepository().isHistoryBlocked(hit.conversationKey))) throw new ProductivityError("CURSOR_EXPIRED", "A conversation was deleted. Refresh the results.", true);
      return { ok: true, value };
    } catch (error) { if (!(error instanceof ProductivityError)) reportError("HISTORY:REQUEST", error); return failure(error); }
  };
  ipcMain.handle("history:search", (event, value: unknown) => result(event, () => {
    return getService().call({ action: "search", request: validateHistorySearch(value, catalog()) });
  }));
  ipcMain.handle("history:timeline", (event, value: unknown) => result(event, () => {
    return getService().call({ action: "timeline", request: validateHistoryTimeline(value, catalog()) });
  }));
  ipcMain.handle("history:activity", (event, value: unknown) => result(event, () => {
    return getService().call({ action: "activity", request: validateHistoryActivity(value, catalog()) });
  }));
  ipcMain.handle("history:resolve", (event, value: unknown) => result(event, async () => {
    validateConversationTargets([value]);
    if (!isRecord(value) || typeof value.projectId !== "string" || typeof value.conversationKey !== "string"
      || typeof value.runtimeSessionId !== "string" || value.messageId !== null && (typeof value.messageId !== "string" || value.messageId.length > 1000)
      || value.spaceId !== null && typeof value.spaceId !== "string") throw new ProductivityError("INVALID_ARGUMENT");
    assertStorageId(value.runtimeSessionId);
    if (getSessionRepository().isHistoryBlocked(value.conversationKey)) throw new ProductivityError("SOURCE_GONE");
    const location: HistoryLocation = { projectId: value.projectId, conversationKey: value.conversationKey, runtimeSessionId: value.runtimeSessionId,
      messageId: value.messageId, spaceId: value.spaceId };
    const resolved = await getService().call({ action: "resolve", request: location });
    if (getSessionRepository().isHistoryBlocked(location.conversationKey)) throw new ProductivityError("SOURCE_GONE");
    return resolved;
  }));
  const controls = ["status", "cancelRebuild"] as const;
  for (const action of controls) ipcMain.handle(`history:${action}`, (event) => result(event, () => {
    const command: HistoryWorkerCommand = { action };
    return getService().call(command);
  }));
  ipcMain.handle("history:rebuild", (event, kind: unknown = "keyword") => result(event, () => {
    if (kind !== "keyword" && kind !== "all") throw new ProductivityError("INVALID_ARGUMENT");
    if (kind === "all" && !getAppSettings().history.semanticEnabled) throw new ProductivityError("SEMANTIC_DISABLED");
    return getService().call({ action: "rebuild", kind });
  }));
  ipcMain.handle("history:semantic-control", (event, action: unknown) => result(event, () => {
    if (action !== "pause" && action !== "resume" && action !== "clear") throw new ProductivityError("INVALID_ARGUMENT");
    if (action === "clear") {
      const settings = setAppSettings({ history: { semanticEnabled: false, embeddingModelKey: null } });
      safeSend(getMainWindow, "settings:changed", settings);
    } else if (!getAppSettings().history.semanticEnabled) throw new ProductivityError("SEMANTIC_DISABLED");
    return getService().call({ action: "semanticControl", control: action });
  }));
  ipcMain.handle("history:cancel", async (event, id: unknown) => {
    assertMainRenderer(event, getMainWindow);
    if (service) await service.call({ action: "cancel", requestId: historyRequestId(id) });
  });
  app.whenReady().then(async () => {
    unsubscribe.push(getSessionRepository().onChange((change) => {
      if (change.kind === "delete") invalidation++;
      if (service) void service.call({ action: "change", change }).catch((error: unknown) => reportError("HISTORY:CHANGE", error));
    }));
    const catalogChanged = () => { invalidation++; refresh(); };
    unsubscribe.push(onProjectsChanged(catalogChanged), onSpacesChanged(catalogChanged));
    let historySettings = JSON.stringify(getAppSettings().history);
    onSettingsChanged((settings) => {
      const next = JSON.stringify(settings.history);
      if (next !== historySettings) { historySettings = next; refresh(); }
    });
    await getSessionRepository().initialize();
    getService(); refresh();
  }).catch((error: unknown) => reportError("HISTORY:START", error));
  app.on("activate", refresh);
}
