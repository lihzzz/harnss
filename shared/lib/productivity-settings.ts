import type { GlobalShortcutSettings, QuickCaptureTarget } from "../types/productivity";
import { HISTORY_EMBEDDING_MODEL } from "./embedding-model";

export const GLOBAL_SHORTCUT_DEFAULTS: GlobalShortcutSettings = {
  enabled: false, wake: "CommandOrControl+Shift+Space", dictate: null, analyzeClipboard: null, keepAliveOnClose: true,
};
export const HISTORY_DEFAULTS = { semanticEnabled: false, embeddingModelKey: null as string | null };

export function mergeHistorySettings(value: unknown, base = HISTORY_DEFAULTS): typeof HISTORY_DEFAULTS {
  if (value === undefined) return { ...base };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid history settings");
  const result = { ...base };
  for (const [key, setting] of Object.entries(value)) {
    if (key === "semanticEnabled" && typeof setting === "boolean") result.semanticEnabled = setting;
    else if (key === "embeddingModelKey" && (setting === null || (typeof setting === "string" && setting.length < 200))) result.embeddingModelKey = setting;
    else throw new Error("Invalid history setting");
  }
  if (result.semanticEnabled && result.embeddingModelKey === null) result.embeddingModelKey = HISTORY_EMBEDDING_MODEL.key;
  return result;
}

export function mergeGlobalShortcuts(value: unknown, base = GLOBAL_SHORTCUT_DEFAULTS): GlobalShortcutSettings {
  if (value === undefined) return { ...base };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid shortcut settings");
  const result = { ...base };
  for (const [key, setting] of Object.entries(value)) {
    if (key === "enabled" || key === "keepAliveOnClose") {
      if (typeof setting !== "boolean") throw new Error("Invalid shortcut setting");
      result[key] = setting;
    } else if (key === "wake" || key === "dictate" || key === "analyzeClipboard") {
      if (setting !== null && (typeof setting !== "string" || !setting.trim() || setting.length > 100)) throw new Error("Invalid shortcut accelerator");
      result[key] = typeof setting === "string" ? setting.trim() : null;
    } else throw new Error("Unknown shortcut setting");
  }
  return result;
}

export function parseQuickCaptureTarget(value: unknown): QuickCaptureTarget | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || !("projectId" in value) || !("agentId" in value)
    || typeof value.projectId !== "string" || typeof value.agentId !== "string" || !value.projectId || !value.agentId
    || value.projectId.length > 200 || value.agentId.length > 200) throw new Error("Invalid quick capture target");
  return { projectId: value.projectId, agentId: value.agentId };
}
