import { ipcMain, type BrowserWindow } from "electron";
import { GlobalShortcuts } from "../lib/global-shortcuts";
import { QuickCapture } from "../lib/quick-capture";
import { assertMainRenderer } from "../lib/productivity-ipc";
import { failure, isRecord, ProductivityError } from "../lib/productivity-errors";
import { parseQuickCaptureTarget } from "@shared/lib/productivity-settings";
import type { OperationError, QuickCaptureState, QuickCaptureTarget } from "@shared/types/productivity";
import { readProjects } from "./projects";
import { getAgent } from "../lib/agent-registry";
import { reportError } from "../lib/error-utils";
import { hasConfiguredClaudeAccount } from "./claude-sessions";
import { hasConfiguredCodexAccount } from "./codex-sessions";
import { getSessionRepository } from "../lib/session-service";

function state(value: unknown): QuickCaptureState {
  if (value === "waitingUI" || value === "awaitingUser" || value === "ready" || value === "dispatched" || value === "completed" || value === "failed" || value === "cancelled") return value;
  throw new ProductivityError("INVALID_ARGUMENT");
}

function resolveTarget(target: QuickCaptureTarget | null) {
  const project = target && readProjects(true).find((entry) => entry.id === target.projectId);
  const agent = target && getAgent(target.agentId);
  if (!project || !agent || getSessionRepository().isProjectBlocked(project.id)) {
    throw new ProductivityError("INVALID_TARGET", "Choose an existing project and installed agent");
  }
  return { project, agent, signature: JSON.stringify([project.path, agent.engine, agent.binary, agent.args, agent.env]) };
}

export function register(getMainWindow: () => BrowserWindow | null, quickCapture: QuickCapture, shortcuts: GlobalShortcuts): void {
  const result = <T>(task: () => T) => {
    try { return { ok: true, value: task() }; }
    catch (error) { if (!(error instanceof ProductivityError)) reportError("QUICK_CAPTURE:IPC_ERR", error); return failure(error); }
  };
  ipcMain.handle("shortcuts:get-status", (event) => result(() => { assertMainRenderer(event, getMainWindow); return shortcuts.status(); }));
  ipcMain.handle("quick-capture:pending", (event) => result(() => { assertMainRenderer(event, getMainWindow); return quickCapture.pending(); }));
  ipcMain.handle("quick-capture:check-target", async (event, request: unknown) => {
    try {
      assertMainRenderer(event, getMainWindow);
      if (!isRecord(request)) throw new ProductivityError("INVALID_ARGUMENT");
      const assertPending = () => {
        const pending = quickCapture.pending();
        if (!pending || pending.requestId !== request.requestId || pending.dispatchAccepted || pending.state === "failed") {
          throw new ProductivityError("INVALID_ARGUMENT", "This quick input request is no longer pending");
        }
      };
      assertPending();
      await getSessionRepository().initialize();
      assertPending();
      const target = parseQuickCaptureTarget(request.target);
      const { project, agent, signature } = resolveTarget(target);
      const ready = agent.engine === "claude" ? await hasConfiguredClaudeAccount(project.path)
        : agent.engine === "codex" ? await hasConfiguredCodexAccount(project.path) : true;
      assertMainRenderer(event, getMainWindow);
      assertPending();
      if (resolveTarget(target).signature !== signature) throw new ProductivityError("INVALID_TARGET", "Choose an existing project and installed agent");
      // ACP authentication is resolved by the prepared draft's handshake, before prompt().
      if (!ready) throw new ProductivityError("AUTH_REQUIRED", "Sign in to the selected agent, then continue.", true);
      return { ok: true, value: { ready: true } };
    } catch (error) { return failure(error); }
  });
  ipcMain.handle("quick-capture:update", (event, request: unknown) => result(() => {
    assertMainRenderer(event, getMainWindow);
    if (!isRecord(request) || typeof request.requestId !== "string" || request.requestId.length > 200) throw new ProductivityError("INVALID_ARGUMENT");
    const nextState = state(request.state);
    const target = parseQuickCaptureTarget(request.target);
    if (target) resolveTarget(target);
    if (nextState === "dispatched") {
      const pending = quickCapture.pending();
      if (pending?.requestId === request.requestId && pending.action === "analyzeClipboard") resolveTarget(target ?? pending.target);
    }
    let error: OperationError | undefined;
    if (request.error !== undefined) {
      if (!isRecord(request.error) || typeof request.error.code !== "string" || typeof request.error.message !== "string" || typeof request.error.retryable !== "boolean") throw new ProductivityError("INVALID_ARGUMENT");
      error = { code: request.error.code.slice(0, 100), message: request.error.message.slice(0, 500), retryable: request.error.retryable };
    }
    return quickCapture.update({ requestId: request.requestId, state: nextState, ...(target ? { target } : {}), ...(error ? { error } : {}) });
  }));
}
