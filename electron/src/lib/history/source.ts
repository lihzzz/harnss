import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { conversationKey } from "@shared/lib/session-identity";
import { normalizeHistoryText, visibleHistoryText } from "@shared/lib/history-text";
import type { HistoryEntryKind } from "@shared/types/productivity";
import { assertStorageId, isMissingFile, isRecord, ProductivityError } from "../productivity-errors";
import { emptyCoverage, type HistoryCatalog, type HistoryConversation, type HistoryEntry, type HistorySnapshot } from "./types";
import { readSessionReplacements, replacementVisibility, runtimeAlias, replacementBackupFile } from "../session-replacements";

const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const validHistoryTime = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value)
  && value > 0 && value <= 8.64e15 ? value : null;

/** Read-only extraction: malformed lines are counted, never rewritten or silently certified complete. */
export function parseHistorySource(text: string, jsonl: boolean): { data: Record<string, unknown>; damagedLines: number } {
  if (!jsonl) {
    const data: unknown = JSON.parse(text);
    if (!isRecord(data) || !Array.isArray(data.messages)) throw new ProductivityError("CORRUPT_SOURCE");
    return { data, damagedLines: 0 };
  }
  let header: Record<string, unknown> = {};
  let hasHeader = false;
  const messages = new Map<string, Record<string, unknown>>();
  let damagedLines = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { damagedLines++; continue; }
    if (isRecord(parsed) && parsed.type === "header") { header = { ...header, ...parsed }; hasHeader = true; }
    else if (isRecord(parsed) && parsed.type === "msg" && isRecord(parsed.msg) && typeof parsed.msg.id === "string" && parsed.msg.id) messages.set(parsed.msg.id, parsed.msg);
    else damagedLines++;
  }
  if (!hasHeader) throw new ProductivityError("CORRUPT_SOURCE", "Session header is missing");
  return { data: { ...header, messages: [...messages.values()] }, damagedLines };
}

export function extractHistoryConversation(data: Record<string, unknown>, projectId: string, id: string, modifiedAt: number, damagedLines = 0): HistoryConversation {
  if (data.projectId !== projectId || data.id !== id) throw new ProductivityError("CORRUPT_SOURCE", "Session identity does not match its source");
  if (data.engine !== undefined && data.engine !== "claude" && data.engine !== "codex" && data.engine !== "acp") throw new ProductivityError("CORRUPT_SOURCE", "Unknown session engine");
  const engine = data.engine ?? "claude";
  const key = conversationKey({ projectId, id, engine, conversationId: typeof data.conversationId === "string" ? data.conversationId : undefined,
    codexThreadId: typeof data.codexThreadId === "string" ? data.codexThreadId : undefined });
  const createdAt = validHistoryTime(data.createdAt);
  const title = typeof data.title === "string" ? data.title : "Untitled";
  const entries: HistoryEntry[] = [];
  function add(messageId: string | null, kind: HistoryEntryKind, text: string, timestamp: number | null, sourceOrder: number, isComplete: boolean) {
    entries.push({ entryKey: JSON.stringify([key, messageId]), messageId, kind, sourceOrder, displayText: text,
      searchText: normalizeHistoryText(text), timestamp, timestampQuality: timestamp === null ? "unknown" : "exact",
      contentHash: hash(text), isComplete });
  }
  add(null, "title", title, createdAt, -1, true);
  const messages = new Map<string, Record<string, unknown>>();
  for (const raw of Array.isArray(data.messages) ? data.messages : []) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) { damagedLines++; continue; }
    messages.set(raw.id, raw);
  }
  let order = 0;
  let lastUserTime: number | null = null;
  for (const [messageId, message] of messages) {
    const sourceOrder = order++;
    if (message.isQueued === true) continue;
    let kind: HistoryEntryKind;
    switch (message.role) {
      case "user": kind = "user"; break;
      case "assistant": kind = "assistant"; break;
      case "tool_call": kind = "tool"; break;
      case "system": kind = "system"; break;
      case "summary": kind = "summary"; break;
      default: continue; // Thinking, standalone tool results, and nested steps have no separate history entry.
    }
    const content = typeof message.content === "string" ? message.content : "";
    const text = kind === "user" ? visibleHistoryText(content, message.displayContent)
      : kind === "tool" ? (typeof message.toolName === "string" ? message.toolName : "Tool") : content;
    const timestamp = validHistoryTime(message.timestamp);
    if (kind === "user" && timestamp !== null) lastUserTime = timestamp;
    add(messageId, kind, text, timestamp, sourceOrder, kind !== "tool" || message.toolResult !== undefined && message.toolResult !== null);
  }
  const conversation: HistoryConversation = { conversationKey: key, projectId, runtimeSessionId: id, engine,
    agentId: typeof data.agentId === "string" ? data.agentId : null, title, archived: data.archived === true,
    createdAt, lastMessageAt: lastUserTime ?? validHistoryTime(data.lastMessageAt) ?? createdAt ?? 0,
    modifiedAt, sourceRevision: "", entries, damagedLines };
  conversation.sourceRevision = hash(JSON.stringify(conversation));
  return conversation;
}

interface CachedSource { stamp: string; conversation: HistoryConversation }
export class HistorySourceReader {
  private cache = new Map<string, CachedSource>();
  constructor(private readonly root: string) {}

  private async readFile(projectId: string, id: string, file: string): Promise<HistoryConversation> {
    const metaFile = path.join(path.dirname(file), `${id}.meta.json`);
    async function version() {
      const source = await fs.lstat(file);
      if (!source.isFile() || source.isSymbolicLink()) throw new ProductivityError("UNSUPPORTED_SOURCE");
      if (source.size > MAX_SOURCE_BYTES) throw new ProductivityError("SOURCE_TOO_LARGE", "Session exceeds the 128 MiB history processing limit");
      const meta = await fs.lstat(metaFile).catch((error: unknown) => { if (isMissingFile(error)) return null; throw error; });
      if (meta && (!meta.isFile() || meta.isSymbolicLink() || meta.size > 1024 * 1024)) throw new ProductivityError("CORRUPT_SOURCE", "Invalid session metadata");
      return { stamp: `${source.ino}:${source.size}:${source.mtimeMs}:${source.ctimeMs}:${meta?.mtimeMs}:${meta?.ctimeMs}:${meta?.size}`, modifiedAt: meta?.mtimeMs ?? source.mtimeMs, hasMeta: Boolean(meta) };
    }
    const before = await version();
    const cached = this.cache.get(file);
    if (cached?.stamp === before.stamp) return cached.conversation;
    const parsed = parseHistorySource(await fs.readFile(file, "utf8"), file.endsWith(".jsonl"));
    if (before.hasMeta) {
      const meta: unknown = JSON.parse(await fs.readFile(metaFile, "utf8"));
      if (!isRecord(meta) || meta.id !== id || meta.projectId !== projectId) throw new ProductivityError("CORRUPT_SOURCE");
      // The sidecar is the committed authority for archive and identity metadata.
      parsed.data = { ...parsed.data, ...meta, messages: parsed.data.messages };
    }
    if ((await version()).stamp !== before.stamp) throw new ProductivityError("SOURCE_CHANGED", "Session changed while history was being read", true);
    const conversation = extractHistoryConversation(parsed.data, projectId, id, before.modifiedAt, parsed.damagedLines);
    this.cache.set(file, { stamp: before.stamp, conversation });
    return conversation;
  }

  async deletionKeys(): Promise<Set<string>> {
    const folder = path.join(this.root, "sessions", ".deletions");
    const files = await fs.readdir(folder).catch((error: unknown) => { if (isMissingFile(error)) return []; throw error; });
    const keys = new Set<string>();
    for (const name of files) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      let record: unknown;
      try { record = JSON.parse(await fs.readFile(path.join(folder, name), "utf8")); }
      catch (error) { if (isMissingFile(error)) continue; throw error; }
      if (!isRecord(record) || typeof record.conversationKey !== "string" || (record.state !== "pending" && record.state !== "committed")) throw new ProductivityError("DELETION_STATE_INVALID");
      keys.add(record.conversationKey);
    }
    const replacements = (await readSessionReplacements(this.root)).filter((record) => record.state === "committed");
    let changed: boolean;
    do {
      changed = false;
      for (const record of replacements) if (keys.has(record.previousKey) && !keys.has(record.conversationKey)) { keys.add(record.conversationKey); changed = true; }
    } while (changed);
    return keys;
  }

  async replacementVisibility() { return replacementVisibility(await readSessionReplacements(this.root)); }

  async deletedProjectIds(): Promise<Set<string>> {
    const folder = path.join(this.root, "sessions", ".project-deletions");
    const files = await fs.readdir(folder).catch((error: unknown) => { if (isMissingFile(error)) return []; throw error; });
    const ids = new Set<string>();
    for (const name of files.filter((file) => file.endsWith(".json"))) {
      let record: unknown;
      try { record = JSON.parse(await fs.readFile(path.join(folder, name), "utf8")); }
      catch (error) { if (isMissingFile(error)) continue; if (error instanceof SyntaxError) throw new ProductivityError("DELETION_STATE_INVALID"); throw error; }
      if (!isRecord(record) || record.version !== 1 || typeof record.projectId !== "string"
        || name !== `${record.projectId}.json` || (record.state !== "pending" && record.state !== "committed")) throw new ProductivityError("DELETION_STATE_INVALID");
      assertStorageId(record.projectId); ids.add(record.projectId);
    }
    return ids;
  }

  async scan(catalog: HistoryCatalog, signal: AbortSignal, onProgress: (processed: number) => void): Promise<HistorySnapshot> {
    const conversations = new Map<string, HistoryConversation>();
    const coverage = emptyCoverage();
    const warningCounts = new Map<string, number>();
    const visited = new Set<string>();
    let processed = 0;
    const [initiallyDeleted, hidden] = await Promise.all([this.deletedProjectIds(), this.replacementVisibility()]);
    const warn = (code: string) => warningCounts.set(code, (warningCounts.get(code) ?? 0) + 1);
    for (const project of catalog.projects) {
      signal.throwIfAborted();
      assertStorageId(project.id);
      if (initiallyDeleted.has(project.id)) continue;
      const folder = path.join(this.root, "sessions", project.id);
      let files;
      try {
        const stat = await fs.lstat(folder);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ProductivityError("UNSUPPORTED_SOURCE");
        files = await fs.readdir(folder, { withFileTypes: true });
      } catch (error) { if (isMissingFile(error)) continue; coverage.failed++; warn("PROJECT_READ_FAILED"); continue; }
      const sources = new Map<string, string>();
      for (const file of files) {
        const match = /^([a-zA-Z0-9_-]{1,200})\.(jsonl|json)$/.exec(file.name);
        if (!match || !file.isFile()) continue;
        if (match[2] === "jsonl" || !sources.has(match[1])) sources.set(match[1], path.join(folder, file.name));
      }
      for (const record of hidden.preparedSources.values()) if (record.projectId === project.id) {
        sources.set(record.runtimeId, replacementBackupFile(this.root, record, record.backupFormats.includes("jsonl") ? "jsonl" : "json"));
      }
      for (const [id, sourceFile] of sources) {
        signal.throwIfAborted();
        if (hidden.runtimeAliases.has(runtimeAlias(project.id, id))) continue;
        const prepared = hidden.preparedSources.get(runtimeAlias(project.id, id));
        const file = prepared ? replacementBackupFile(this.root, prepared, prepared.backupFormats.includes("jsonl") ? "jsonl" : "json") : sourceFile;
        visited.add(file);
        try {
          const candidate = await this.readFile(project.id, id, file);
          if (hidden.logicalKeys.has(candidate.conversationKey)) continue;
          const previous = conversations.get(candidate.conversationKey);
          if (!previous || candidate.lastMessageAt > previous.lastMessageAt || candidate.lastMessageAt === previous.lastMessageAt
            && (candidate.modifiedAt > previous.modifiedAt || candidate.modifiedAt === previous.modifiedAt && candidate.runtimeSessionId < previous.runtimeSessionId)) conversations.set(candidate.conversationKey, candidate);
        } catch (error) {
          const code = error instanceof ProductivityError ? error.code : "SOURCE_READ_FAILED";
          if (code === "SOURCE_TOO_LARGE" || code === "UNSUPPORTED_SOURCE") coverage.skipped++; else coverage.failed++;
          warn(code);
        }
        onProgress(++processed);
      }
    }
    for (const file of this.cache.keys()) if (!visited.has(file)) this.cache.delete(file);
    // Check at publication, after all awaits, so a concurrent durable deletion never reappears.
    const [deleted, deletedProjects, replaced] = await Promise.all([this.deletionKeys(), this.deletedProjectIds(), this.replacementVisibility()]);
    for (const key of deleted) conversations.delete(key);
    for (const [key, conversation] of conversations) if (deletedProjects.has(conversation.projectId) || replaced.logicalKeys.has(key)
      || replaced.runtimeAliases.has(runtimeAlias(conversation.projectId, conversation.runtimeSessionId))) conversations.delete(key);
    for (const conversation of conversations.values()) {
      if (conversation.damagedLines) { warn("DAMAGED_SOURCE_LINES"); coverage.failed++; } else coverage.indexed++;
    }
    coverage.discovered = conversations.size + coverage.skipped + coverage.failed - [...conversations.values()].filter((item) => item.damagedLines).length;
    coverage.keywordComplete = coverage.failed === 0 && coverage.skipped === 0;
    const warnings = [...warningCounts].map(([code, count]) => ({ code, message: `${code}: ${count}`, retryable: true }));
    const signature = hash(JSON.stringify([catalog, [...conversations.values()].map((item) => [item.conversationKey, item.sourceRevision]).sort(), coverage]));
    return { conversations, coverage, warnings, signature };
  }

  clearCache(): void { this.cache.clear(); }
}
