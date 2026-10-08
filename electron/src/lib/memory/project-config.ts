import crypto from "node:crypto";
import { JsonFileStore } from "../json-file-store";
import type { MemoryProjectConfig } from "@shared/types/memory";

const DEFAULT_CONFIG: MemoryProjectConfig = { memoryMode: "manual", memoryIsolated: false };
const store = new JsonFileStore<MemoryProjectConfig>({
  subDir: "memory-project-config",
  sanitizeKey: (key) => key.replace(/[^a-zA-Z0-9_-]/g, "-") || "unknown",
  label: "MEMORY_PROJECT_CONFIG",
});

function storageKey(projectId: string): string {
  const safe = projectId.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96) || "unknown";
  return `${safe}-${crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 12)}`;
}

export function getMemoryProjectConfig(projectId: string): MemoryProjectConfig {
  const saved = store.load(storageKey(projectId));
  return { ...DEFAULT_CONFIG, ...(saved ?? {}) };
}

export function setMemoryProjectConfig(projectId: string, patch: Partial<MemoryProjectConfig>): MemoryProjectConfig {
  const next = { ...getMemoryProjectConfig(projectId), ...patch };
  store.save(storageKey(projectId), next);
  return next;
}
