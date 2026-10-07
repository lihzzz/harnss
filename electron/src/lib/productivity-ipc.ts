import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { readProjects } from "../ipc/projects";
import { assertStorageId, isRecord, ProductivityError } from "./productivity-errors";
import type { ConversationRef } from "@shared/types/productivity";

export function assertMainRenderer(event: IpcMainInvokeEvent, getMainWindow: () => BrowserWindow | null): void {
  const window = getMainWindow();
  if (!window || window.isDestroyed() || event.sender !== window.webContents || !event.senderFrame
    || event.senderFrame !== window.webContents.mainFrame) throw new ProductivityError("FORBIDDEN_SENDER");
}

export function validateConversationTargets(value: unknown): ConversationRef[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) throw new ProductivityError("INVALID_ARGUMENT");
  const projects = new Set(readProjects().map((project) => project.id));
  return value.map((candidate: unknown) => {
    if (!isRecord(candidate) || typeof candidate.projectId !== "string" || typeof candidate.conversationKey !== "string"
      || candidate.conversationKey.length > 1000) throw new ProductivityError("INVALID_ARGUMENT");
    assertStorageId(candidate.projectId);
    if (!projects.has(candidate.projectId)) throw new ProductivityError("INVALID_TARGET", "The project no longer exists");
    let tuple: unknown;
    try { tuple = JSON.parse(candidate.conversationKey); } catch { throw new ProductivityError("INVALID_ARGUMENT"); }
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple[0] !== candidate.projectId
      || !["claude", "codex", "acp"].includes(String(tuple[1])) || typeof tuple[2] !== "string" || !tuple[2]) throw new ProductivityError("INVALID_ARGUMENT");
    return { projectId: candidate.projectId, conversationKey: candidate.conversationKey };
  });
}
