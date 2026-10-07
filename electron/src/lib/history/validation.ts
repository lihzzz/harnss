import { historyDateRange, localHistoryDate } from "@shared/lib/history-time";
import type { EngineId } from "@shared/types/engine";
import type { HistoryActivityRequest, HistoryScope, HistorySearchRequest, HistoryTimelineRequest } from "@shared/types/productivity";
import { assertStorageId, isRecord, ProductivityError } from "../productivity-errors";
import type { HistoryCatalog } from "./types";

export function historyRequestId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw new ProductivityError("INVALID_ARGUMENT", "Invalid history request ID");
  return value;
}
function scope(value: unknown, catalog: HistoryCatalog): HistoryScope {
  if (!isRecord(value)) throw new ProductivityError("INVALID_ARGUMENT");
  if (value.kind === "all") return { kind: "all" };
  if (value.kind === "space" && typeof value.spaceId === "string" && catalog.spaces.some((space) => space.id === value.spaceId)) return { kind: "space", spaceId: value.spaceId };
  if (value.kind === "projects" && Array.isArray(value.projectIds) && value.projectIds.length <= 500) {
    const projectIds: string[] = [];
    for (const id of value.projectIds) {
      assertStorageId(id);
      if (!catalog.projects.some((project) => project.id === id)) throw new ProductivityError("INVALID_TARGET", "The project no longer exists", true);
      projectIds.push(id);
    }
    return { kind: "projects", projectIds: [...new Set(projectIds)].sort() };
  }
  throw new ProductivityError("INVALID_ARGUMENT", "Invalid history scope");
}
function filters(value: Record<string, unknown>, catalog: HistoryCatalog) {
  const engines: EngineId[] = [];
  if (!Array.isArray(value.engines) || value.engines.length > 3 || typeof value.includeArchived !== "boolean") throw new ProductivityError("INVALID_ARGUMENT");
  for (const engine of value.engines) {
    if (engine !== "claude" && engine !== "codex" && engine !== "acp") throw new ProductivityError("INVALID_ARGUMENT");
    if (!engines.includes(engine)) engines.push(engine);
  }
  return { requestId: historyRequestId(value.requestId), scope: scope(value.scope, catalog), engines: engines.sort(), includeArchived: value.includeArchived };
}
function paging(value: Record<string, unknown>) {
  if (typeof value.limit !== "number" || !Number.isInteger(value.limit) || value.limit < 1 || value.limit > 100
    || value.cursor !== null && (typeof value.cursor !== "string" || value.cursor.length > 4096)) throw new ProductivityError("INVALID_ARGUMENT");
  const from = value.from, to = value.to;
  for (const timestamp of [from, to]) if (timestamp !== null && (typeof timestamp !== "number" || !Number.isFinite(timestamp) || Math.abs(timestamp) > 8.64e15)) throw new ProductivityError("INVALID_ARGUMENT");
  if (from !== null && typeof from !== "number" || to !== null && typeof to !== "number") throw new ProductivityError("INVALID_ARGUMENT");
  if (from !== null && to !== null && from >= to) throw new ProductivityError("INVALID_ARGUMENT", "The date range is empty");
  return { limit: value.limit, cursor: value.cursor, from, to };
}
export function validateHistorySearch(value: unknown, catalog: HistoryCatalog): HistorySearchRequest {
  if (!isRecord(value) || typeof value.query !== "string" || value.query.length > 4096) throw new ProductivityError("INVALID_ARGUMENT");
  const query = value.query.trim();
  if ([...query].length < 1 || [...query].length > 512) throw new ProductivityError("INVALID_QUERY", "Enter between 1 and 512 characters");
  if (value.mode !== "keyword" && value.mode !== "semantic" && value.mode !== "hybrid" || value.sort !== "recent" && value.sort !== "relevance") throw new ProductivityError("INVALID_ARGUMENT");
  return { ...filters(value, catalog), ...paging(value), query, mode: value.mode, sort: value.mode === "keyword" ? value.sort : "relevance" };
}
export function validateHistoryTimeline(value: unknown, catalog: HistoryCatalog): HistoryTimelineRequest {
  if (!isRecord(value) || typeof value.unknownTime !== "boolean") throw new ProductivityError("INVALID_ARGUMENT");
  return { ...filters(value, catalog), ...paging(value), unknownTime: value.unknownTime };
}
export function validateHistoryActivity(value: unknown, catalog: HistoryCatalog): HistoryActivityRequest {
  if (!isRecord(value) || typeof value.fromDate !== "string" || typeof value.toDate !== "string" || typeof value.timeZone !== "string" || value.timeZone.length > 100) throw new ProductivityError("INVALID_ARGUMENT");
  try { historyDateRange(value.fromDate, value.toDate); localHistoryDate(Date.now(), value.timeZone); }
  catch (error) { throw new ProductivityError("INVALID_ARGUMENT", error instanceof Error ? error.message : "Invalid calendar range"); }
  return { ...filters(value, catalog), fromDate: value.fromDate, toDate: value.toDate, timeZone: value.timeZone };
}
