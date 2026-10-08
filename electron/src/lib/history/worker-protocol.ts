import type { HistoryActivityRequest, HistoryActivityResponse, HistoryIndexStatus, HistoryLocation, HistorySearchRequest,
  HistorySearchResponse, HistoryTimelineRequest, HistoryTimelineResponse, OperationResult } from "@shared/types/productivity";
import type { HistoryCatalog } from "./types";
import type { SessionChange } from "../session-repository";

export type HistoryWorkerCommand = (
  | { action: "search"; request: HistorySearchRequest }
  | { action: "timeline"; request: HistoryTimelineRequest }
  | { action: "activity"; request: HistoryActivityRequest }
  | { action: "resolve"; request: HistoryLocation }
  | { action: "status" | "refresh" | "cancelRebuild" | "close" }
  | { action: "rebuild"; kind?: "keyword" | "all" }
  | { action: "semanticControl"; control: "pause" | "resume" | "clear" }
  | { action: "cancel"; requestId: string }
  | { action: "change"; change: SessionChange }
);
export type HistoryWorkerRequest = { id: string; catalog: HistoryCatalog; semantic?: { semanticEnabled: boolean; embeddingModelKey: string | null } } & HistoryWorkerCommand;
export type HistoryWorkerValue = HistorySearchResponse | HistoryTimelineResponse | HistoryActivityResponse | HistoryLocation | HistoryIndexStatus | null;
export type HistoryWorkerResponse = { type: "status"; value: HistoryIndexStatus } | { type: "reply"; id: string; result: OperationResult<HistoryWorkerValue> };
