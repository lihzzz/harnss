import { BrowserWindow, ipcMain } from "electron";
import type { MemoryProjectConfig } from "@shared/types/memory";
import { getAppSettings, setAppSettings } from "../lib/app-settings";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import {
  clearMemoryKey,
  deleteMemoryDocument,
  getMemoryProjectConfig,
  getMemoryStatus,
  listMemoryDocuments,
  listMemoryUnits,
  memoryHasKey,
  retainManualMemory,
  setMemoryEnabled,
  setMemoryKey,
  setMemoryProjectConfig,
  testMemoryLlm,
  updateMemoryUnit,
  runMemoryGoldenSet,
} from "../lib/memory/service";
import { MEMORY_USER_BANK } from "../lib/memory/bank-router";
import { installMemoryDependencies } from "../lib/memory/daemon";

function normalizeProjectPatch(patch: Partial<MemoryProjectConfig>): Partial<MemoryProjectConfig> {
  const next: Partial<MemoryProjectConfig> = {};
  if (patch.memoryMode === "auto" || patch.memoryMode === "manual" || patch.memoryMode === "off") next.memoryMode = patch.memoryMode;
  if (typeof patch.memoryIsolated === "boolean") next.memoryIsolated = patch.memoryIsolated;
  return next;
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("memory:get-status", async () => getMemoryStatus());

  ipcMain.handle("memory:set-llm-key", async (_event, key: unknown) => {
    if (typeof key !== "string") return { error: "LLM key must be a string" };
    try {
      setMemoryKey(key);
      if (getAppSettings().memory.enabled) {
        await setMemoryEnabled(false);
        await setMemoryEnabled(true);
      }
      return { ok: true, hasLlmKey: memoryHasKey() };
    } catch (error) {
      return { error: reportError("MEMORY_SET_KEY_ERR", error) };
    }
  });

  ipcMain.handle("memory:clear-llm-key", async () => {
    try {
      clearMemoryKey();
      if (getAppSettings().memory.enabled) {
        await setMemoryEnabled(false);
        await setMemoryEnabled(true);
      }
      return { ok: true };
    } catch (error) {
      return { error: reportError("MEMORY_CLEAR_KEY_ERR", error) };
    }
  });

  ipcMain.handle("memory:test-connection", async () => {
    const result = await testMemoryLlm(MEMORY_USER_BANK);
    return result;
  });

  ipcMain.handle("memory:daemon-start", async () => {
    try {
      setAppSettings({ memory: { ...getAppSettings().memory, enabled: true } });
      await setMemoryEnabled(true);
      return { ok: true, status: await getMemoryStatus() };
    } catch (error) {
      setAppSettings({ memory: { ...getAppSettings().memory, enabled: false } });
      return { error: reportError("MEMORY_DAEMON_START_ERR", error), status: await getMemoryStatus() };
    }
  });

  ipcMain.handle("memory:daemon-stop", async () => {
    try {
      setAppSettings({ memory: { ...getAppSettings().memory, enabled: false } });
      await setMemoryEnabled(false);
      return { ok: true };
    } catch (error) {
      return { error: reportError("MEMORY_DAEMON_STOP_ERR", error) };
    }
  });

  ipcMain.handle("memory:daemon-install-deps", async () => {
    try {
      const installed = await installMemoryDependencies();
      if (!installed.ok) {
        setAppSettings({ memory: { ...getAppSettings().memory, enabled: false } });
        return { error: installed.error ?? "Unable to install uv" };
      }
      setAppSettings({ memory: { ...getAppSettings().memory, enabled: true } });
      await setMemoryEnabled(true);
      return { ok: true, status: await getMemoryStatus() };
    } catch (error) {
      setAppSettings({ memory: { ...getAppSettings().memory, enabled: false } });
      return { error: reportError("MEMORY_DAEMON_INSTALL_ERR", error) };
    }
  });

  ipcMain.handle("memory:list-documents", async (_event, bankId: unknown) => {
    if (typeof bankId !== "string" || !bankId.trim()) return { error: "bankId is required" };
    try {
      const result = await listMemoryDocuments(bankId.trim());
      return {
        documents: (result?.items ?? []).map((item) => ({
          id: item.id,
          bankId: item.bank_id,
          originalText: undefined,
          memoryUnitCount: item.memory_unit_count,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          tags: item.tags,
        })),
        total: result?.total ?? 0,
      };
    } catch (error) {
      return { error: reportError("MEMORY_DOCUMENT_LIST_ERR", error) };
    }
  });

  ipcMain.handle("memory:delete-document", async (_event, data: { bankId?: unknown; documentId?: unknown }) => {
    if (typeof data?.bankId !== "string" || typeof data?.documentId !== "string") return { error: "bankId and documentId are required" };
    const ok = await deleteMemoryDocument(data.bankId, data.documentId);
    return ok ? { ok: true } : { error: "Unable to delete memory document" };
  });

  ipcMain.handle("memory:list-memories", async (_event, bankId: unknown) => {
    if (typeof bankId !== "string" || !bankId.trim()) return { error: "bankId is required" };
    try {
      const result = await listMemoryUnits(bankId.trim());
      return {
        memories: (result?.items ?? []).map((item) => ({
          id: item.id,
          bankId: bankId.trim(),
          text: item.text ?? "",
          context: item.context,
          factType: item.fact_type ?? undefined,
          documentId: item.document_id ?? undefined,
          state: item.state,
          tags: item.tags,
          proofCount: item.proof_count,
          sourceMemoryIds: item.source_memory_ids,
          updatedAt: item.updated_at,
        })),
        total: result?.total ?? 0,
      };
    } catch (error) {
      return { error: reportError("MEMORY_UNIT_LIST_ERR", error) };
    }
  });

  ipcMain.handle("memory:update-memory", async (_event, data: { bankId?: unknown; memoryId?: unknown; patch?: Record<string, unknown> }) => {
    if (typeof data?.bankId !== "string" || typeof data?.memoryId !== "string") return { error: "bankId and memoryId are required" };
    const raw = data.patch ?? {};
    const patch: { text?: string; context?: string; state?: "valid" | "invalidated"; reason?: string } = {};
    if (typeof raw.text === "string" && raw.text.trim()) patch.text = raw.text.trim();
    if (typeof raw.context === "string") patch.context = raw.context;
    if (raw.state === "valid" || raw.state === "invalidated") patch.state = raw.state;
    if (typeof raw.reason === "string") patch.reason = raw.reason;
    if (!Object.keys(patch).length) return { error: "An update text, state, or context is required" };
    const ok = await updateMemoryUnit(data.bankId, data.memoryId, patch);
    return ok ? { ok: true } : { error: "Unable to update memory" };
  });

  ipcMain.handle("memory:run-golden-set", async (_event, bankId: unknown) => {
    if (typeof bankId !== "string" || !bankId.trim()) return { error: "bankId is required" };
    try {
      const report = await runMemoryGoldenSet(bankId.trim());
      return report ? { report } : { error: "Hindsight daemon is not ready" };
    } catch (error) {
      return { error: reportError("MEMORY_GOLDEN_SET_ERR", error) };
    }
  });

  ipcMain.handle("memory:retain-manual", async (_event, data: { sessionId?: unknown; content?: unknown }) => {
    if (typeof data?.sessionId !== "string" || typeof data?.content !== "string") return { error: "sessionId and content are required" };
    return retainManualMemory(data.sessionId, data.content);
  });

  ipcMain.handle("memory:get-project-config", (_event, projectId: unknown) => {
    if (typeof projectId !== "string") return { error: "projectId is required" };
    return getMemoryProjectConfig(projectId);
  });

  ipcMain.handle("memory:set-project-config", (_event, data: { projectId?: unknown; patch?: Partial<MemoryProjectConfig> }) => {
    if (typeof data?.projectId !== "string") return { error: "projectId is required" };
    return setMemoryProjectConfig(data.projectId, normalizeProjectPatch(data.patch ?? {}));
  });

  // Keep a cheap status event available for a future settings panel refresh.
  safeSend(getMainWindow, "memory:status", { hasLlmKey: memoryHasKey() });
}
