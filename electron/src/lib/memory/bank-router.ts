import crypto from "node:crypto";
import type { MemoryProjectConfig } from "@shared/types/memory";

export const MEMORY_USER_BANK = "harnss-user";

export function projectBankId(projectId: string): string {
  const safe = projectId.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 96);
  const suffix = crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 12);
  return `harnss-project-${safe || "unknown"}-${suffix}`;
}

export function bankTags(projectId: string, engine: string, source: "manual" | "auto", sessionId?: string): string[] {
  return [
    `project:${projectId}`,
    `engine:${engine}`,
    `source:${source}`,
    ...(sessionId ? [`session:${sessionId}`] : []),
  ];
}

/** User-bank memories are intentionally shared across projects. */
export function tagsForBank(bankId: string, projectId: string, engine: string, source: "manual" | "auto", sessionId?: string): string[] {
  if (bankId === MEMORY_USER_BANK) {
    return [`scope:user`, `engine:${engine}`, `source:${source}`];
  }
  return bankTags(projectId, engine, source, sessionId);
}

export function banksForProject(projectId: string, config: MemoryProjectConfig): string[] {
  if (config.memoryIsolated) return [projectBankId(projectId)];
  return [MEMORY_USER_BANK, projectBankId(projectId)];
}

export function memoryMcpUrl(baseUrl: string, bankId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/mcp/${encodeURIComponent(bankId)}/`;
}
