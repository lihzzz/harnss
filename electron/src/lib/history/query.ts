import { createHash } from "node:crypto";
import { historySnippet, normalizeHistoryText } from "@shared/lib/history-text";
import { historyDateRange, localHistoryDate } from "@shared/lib/history-time";
import type { HistoryActivityRequest, HistoryActivityResponse, HistoryHit, HistorySearchRequest, HistorySearchResponse,
  HistoryTimelineRequest, HistoryTimelineResponse, HistoryTimelineItem, HistoryScope, OperationError } from "@shared/types/productivity";
import { isRecord, ProductivityError } from "../productivity-errors";
import type { HistoryCatalog, HistoryConversation, HistoryEntry, HistorySnapshot } from "./types";
import type { SemanticMatch } from "./semantic";

export interface HistoryQueryContext { snapshot: HistorySnapshot; catalog: HistoryCatalog; generation: number; backend: "sqlite" | "scan" }
export interface EntryMatch { conversation: HistoryConversation; entry: HistoryEntry; score: number }
export function projectsForScope(scope: HistoryScope, catalog: HistoryCatalog): Set<string> {
  return new Set(catalog.projects.filter((project) => scope.kind === "all" || (scope.kind === "space" ? project.spaceId === scope.spaceId : scope.projectIds.includes(project.id))).map((project) => project.id));
}

function cursorFingerprint(value: HistorySearchRequest | HistoryTimelineRequest): string {
  const { requestId: _request, cursor: _cursor, ...query } = value;
  return createHash("sha256").update(JSON.stringify(query)).digest("hex");
}
function offsetFor(request: HistorySearchRequest | HistoryTimelineRequest, generation: number): number {
  if (!request.cursor) return 0;
  let cursor: unknown;
  try { cursor = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")); } catch { throw new ProductivityError("INVALID_CURSOR"); }
  if (!isRecord(cursor) || !Number.isSafeInteger(cursor.offset) || typeof cursor.offset !== "number" || cursor.offset < 0) throw new ProductivityError("INVALID_CURSOR");
  if (cursor.generation !== generation || cursor.query !== cursorFingerprint(request)) throw new ProductivityError("CURSOR_EXPIRED", "History changed. Refresh before loading more results.", true);
  return cursor.offset;
}
function nextCursor(request: HistorySearchRequest | HistoryTimelineRequest, generation: number, offset: number): string {
  return Buffer.from(JSON.stringify({ generation, query: cursorFingerprint(request), offset })).toString("base64url");
}
function recent(a: EntryMatch, b: EntryMatch): number {
  return (b.entry.timestamp ?? -Infinity) - (a.entry.timestamp ?? -Infinity) || a.entry.entryKey.localeCompare(b.entry.entryKey);
}
function filtered(request: Pick<HistorySearchRequest, "scope" | "engines" | "includeArchived">, context: HistoryQueryContext): HistoryConversation[] {
  const projects = projectsForScope(request.scope, context.catalog);
  return [...context.snapshot.conversations.values()].filter((conversation) => projects.has(conversation.projectId)
    && (request.includeArchived || !conversation.archived) && (!request.engines.length || request.engines.includes(conversation.engine)));
}
export function inHistoryRange(entry: HistoryEntry, from: number | null, to: number | null): boolean {
  return (from === null || entry.timestamp !== null && entry.timestamp >= from) && (to === null || entry.timestamp !== null && entry.timestamp < to);
}
export function historyHit(match: EntryMatch, context: HistoryQueryContext, query: string): HistoryHit {
  const { conversation, entry } = match;
  const project = context.catalog.projects.find((item) => item.id === conversation.projectId);
  const spaceId = project?.spaceId ?? null;
  return { hitId: entry.entryKey, kind: entry.kind === "title" ? "session" : "message", projectId: conversation.projectId,
    conversationKey: conversation.conversationKey, runtimeSessionId: conversation.runtimeSessionId, messageId: entry.messageId, spaceId,
    projectName: project?.name ?? conversation.projectId, spaceName: context.catalog.spaces.find((space) => space.id === spaceId)?.name ?? null,
    engine: conversation.engine, agentId: conversation.agentId, sessionTitle: conversation.title, archived: conversation.archived,
    timestamp: entry.timestamp, timestampQuality: entry.timestampQuality, ...historySnippet(entry.displayText, query), matchSources: [] };
}

export async function searchHistory(request: HistorySearchRequest, context: HistoryQueryContext, signal: AbortSignal,
  candidateKeys?: ReadonlyMap<string, number>, semanticMatches?: SemanticMatch[], semanticError?: OperationError): Promise<HistorySearchResponse> {
  const query = normalizeHistoryText(request.query.trim());
  const warnings: OperationError[] = [...context.snapshot.warnings];
  if (request.mode === "semantic" && !semanticMatches) throw new ProductivityError(semanticError?.code ?? "SEMANTIC_NOT_READY", semanticError?.message ?? "Local semantic search is not ready", true);
  if (request.mode === "hybrid" && !semanticMatches) warnings.push(semanticError ?? { code: "KEYWORD_FALLBACK", message: "Local semantic search is not ready; showing keyword matches", retryable: true });
  const offset = offsetFor(request, context.generation);
  const matches: EntryMatch[] = [];
  const semanticByKey = new Map(semanticMatches?.map((match) => [match.entryKey, match]));
  const vectors: EntryMatch[] = [];
  let visited = 0;
  for (const conversation of filtered(request, context)) {
    for (const entry of conversation.entries) {
      if (entry.kind !== "title" && entry.kind !== "user" && entry.kind !== "assistant") continue;
      if (!inHistoryRange(entry, request.from, request.to)) continue;
      const vector = semanticByKey.get(entry.entryKey);
      if (vector?.entryContentHash === entry.contentHash) vectors.push({ conversation, entry, score: vector.score });
      if (request.mode === "semantic") continue;
      if (candidateKeys && !candidateKeys.has(entry.entryKey)) continue;
      if (!entry.searchText.includes(query)) continue;
      matches.push({ conversation, entry, score: entry.kind === "title" ? (entry.searchText === query ? 0 : 1) : 2 });
    }
    if (++visited % 32 === 0) { await new Promise<void>((resolve) => setImmediate(resolve)); signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  matches.sort(request.sort === "recent" && request.mode === "keyword" ? recent : (a, b) => a.score - b.score
    || (candidateKeys?.get(a.entry.entryKey) ?? 0) - (candidateKeys?.get(b.entry.entryKey) ?? 0) || recent(a, b));
  vectors.sort((a, b) => b.score - a.score || a.entry.entryKey.localeCompare(b.entry.entryKey));
  const ranked = new Map<string, { match: EntryMatch; score: number; sources: HistoryHit["matchSources"] }>();
  const usingSemantic = request.mode !== "keyword" && semanticMatches !== undefined;
  if (request.mode !== "semantic") for (const [rank, match] of (usingSemantic ? matches.slice(0, 100) : matches).entries()) {
    ranked.set(match.entry.entryKey, { match, score: 1 / (60 + rank + 1), sources: [match.entry.kind === "title" ? "title" : "keyword"] });
  }
  if (usingSemantic) for (const [rank, match] of vectors.slice(0, 100).entries()) {
    const old = ranked.get(match.entry.entryKey);
    ranked.set(match.entry.entryKey, { match, score: (old?.score ?? 0) + 1 / (60 + rank + 1), sources: [...old?.sources ?? [], "semantic"] });
  }
  const ordered = usingSemantic ? [...ranked.values()].sort((a, b) => b.score - a.score || a.match.entry.entryKey.localeCompare(b.match.entry.entryKey)).slice(0, 200) : [...ranked.values()];
  const hits = ordered.slice(offset, offset + request.limit).map(({ match, sources }) => {
    const hit = historyHit(match, context, query);
    const chunk = sources.includes("semantic") ? semanticByKey.get(match.entry.entryKey) : undefined;
    return { ...hit, ...(chunk ? historySnippet(match.entry.displayText.slice(chunk.start, chunk.end), query) : {}), matchSources: sources };
  });
  return { requestId: request.requestId, generation: context.generation, backend: context.backend, modeUsed: usingSemantic ? request.mode : "keyword", hits,
    nextCursor: offset + request.limit < ordered.length ? nextCursor(request, context.generation, offset + request.limit) : null,
    rankingWindow: usingSemantic ? 200 : null, warnings, coverage: context.snapshot.coverage };
}

export async function timelineHistory(request: HistoryTimelineRequest, context: HistoryQueryContext, signal: AbortSignal): Promise<HistoryTimelineResponse> {
  const offset = offsetFor(request, context.generation);
  const matches: EntryMatch[] = [];
  let visited = 0;
  for (const conversation of filtered(request, context)) {
    for (const entry of conversation.entries) {
      if (entry.kind === "title" || request.unknownTime !== (entry.timestamp === null)) continue;
      if (request.unknownTime || inHistoryRange(entry, request.from, request.to)) matches.push({ conversation, entry, score: 0 });
    }
    if (++visited % 32 === 0) { await new Promise<void>((resolve) => setImmediate(resolve)); signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  matches.sort(recent);
  const items: HistoryTimelineItem[] = [];
  for (const match of matches.slice(offset, offset + request.limit)) {
    if (match.entry.kind !== "title") items.push({ ...historyHit(match, context, ""), interaction: match.entry.kind });
  }
  return { requestId: request.requestId, generation: context.generation, items, coverage: context.snapshot.coverage,
    warnings: context.snapshot.warnings, nextCursor: offset + request.limit < matches.length ? nextCursor(request, context.generation, offset + request.limit) : null };
}

export async function activityHistory(request: HistoryActivityRequest, context: HistoryQueryContext, signal: AbortSignal): Promise<HistoryActivityResponse> {
  const counts = new Map(historyDateRange(request.fromDate, request.toDate).map((date) => [date, 0]));
  let unknownUserCount = 0, visited = 0;
  for (const conversation of filtered(request, context)) {
    for (const entry of conversation.entries) {
      if (entry.kind !== "user") continue;
      if (entry.timestamp === null || entry.timestampQuality !== "exact") { unknownUserCount++; continue; }
      const date = localHistoryDate(entry.timestamp, request.timeZone);
      if (counts.has(date)) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    if (++visited % 32 === 0) { await new Promise<void>((resolve) => setImmediate(resolve)); signal.throwIfAborted(); }
  }
  signal.throwIfAborted();
  return { requestId: request.requestId, generation: context.generation, days: [...counts].map(([date, count]) => ({ date, count })),
    unknownUserCount, coverage: context.snapshot.coverage, warnings: context.snapshot.warnings };
}
