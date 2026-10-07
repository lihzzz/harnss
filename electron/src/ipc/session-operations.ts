import { dialog, ipcMain, type BrowserWindow } from "electron";
import { SessionOperations } from "../lib/session-operations";
import { deleteConversation, getSessionRepository } from "../lib/session-service";
import { assertMainRenderer, validateConversationTargets } from "../lib/productivity-ipc";
import { failure, isRecord, ProductivityError } from "../lib/productivity-errors";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import type { BatchJob, BatchPreparedRequest, OperationResult } from "@shared/types/productivity";

export function register(getMainWindow: () => BrowserWindow | null): void {
  let operations: SessionOperations | null = null;
  const service = () => operations ??= new SessionOperations({
    repository: getSessionRepository(), remove: deleteConversation,
    chooseDirectory: async () => {
      const window = getMainWindow();
      if (!window || window.isDestroyed()) throw new ProductivityError("UI_NOT_READY");
      const result = await dialog.showOpenDialog(window, { title: "Export conversations", properties: ["openDirectory", "createDirectory"] });
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    progress: (job) => safeSend(getMainWindow, "sessions:batch-progress", job),
    prepare: (job) => safeSend(getMainWindow, "sessions:batch-prepare", job),
  });
  const result = async (task: () => Promise<BatchJob> | BatchJob): Promise<OperationResult<BatchJob>> => {
    try { return { ok: true, value: await task() }; }
    catch (error) { if (!(error instanceof ProductivityError)) reportError("SESSIONS:BATCH_ERR", error); return failure(error); }
  };
  ipcMain.handle("sessions:batch-recoveries", async (event): Promise<OperationResult<BatchJob[]>> => {
    try { assertMainRenderer(event, getMainWindow); return { ok: true, value: await service().recoveries() }; }
    catch (error) { reportError("SESSIONS:RECOVERY_ERR", error); return failure(error); }
  });
  ipcMain.handle("sessions:batch-start", (event, request: unknown) => result(() => {
    assertMainRenderer(event, getMainWindow);
    if (!isRecord(request) || typeof request.requestId !== "string" || !["archive", "delete", "exportMarkdown"].includes(String(request.action))) throw new ProductivityError("INVALID_ARGUMENT");
    const action = request.action;
    if (action !== "archive" && action !== "delete" && action !== "exportMarkdown") throw new ProductivityError("INVALID_ARGUMENT");
    return service().start({ requestId: request.requestId, action, targets: validateConversationTargets(request.targets) });
  }));
  ipcMain.handle("sessions:batch-status", (event, jobId: unknown) => result(() => {
    assertMainRenderer(event, getMainWindow);
    if (typeof jobId !== "string" || jobId.length > 200) throw new ProductivityError("INVALID_ARGUMENT");
    return service().status(jobId);
  }));
  ipcMain.handle("sessions:batch-cancel", (event, jobId: unknown) => result(() => {
    assertMainRenderer(event, getMainWindow);
    if (typeof jobId !== "string" || jobId.length > 200) throw new ProductivityError("INVALID_ARGUMENT");
    return service().cancel(jobId);
  }));
  ipcMain.handle("sessions:batch-prepared", (event, request: unknown) => result(() => {
    assertMainRenderer(event, getMainWindow);
    if (!isRecord(request) || typeof request.jobId !== "string" || typeof request.prepareId !== "string" || !Array.isArray(request.results) || request.results.length > 500) throw new ProductivityError("INVALID_ARGUMENT");
    const results: BatchPreparedRequest["results"] = request.results.map((value: unknown) => {
      if (!isRecord(value) || typeof value.ok !== "boolean") throw new ProductivityError("INVALID_ARGUMENT");
      const [target] = validateConversationTargets([value]);
      return { ...target, ok: value.ok, error: typeof value.error === "string" ? value.error.slice(0, 500) : undefined, inProgress: value.inProgress === true };
    });
    return service().prepared({ jobId: request.jobId, prepareId: request.prepareId, results });
  }));
}
