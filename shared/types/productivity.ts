import type { EngineId } from "./engine";

export type QuickCaptureAction = "wake" | "dictate" | "analyzeClipboard";
export interface GlobalShortcutSettings {
  enabled: boolean;
  wake: string | null;
  dictate: string | null;
  analyzeClipboard: string | null;
  keepAliveOnClose: boolean;
}
export interface QuickCaptureTarget { projectId: string; agentId: string }
export interface ShortcutStatus {
  action: QuickCaptureAction;
  configured: string | null;
  effective: string | null;
  registered: boolean;
  error: OperationError | null;
}
export type QuickCaptureState = "waitingUI" | "awaitingUser" | "ready" | "dispatched" | "completed" | "failed" | "cancelled";
export interface QuickCaptureRequest {
  requestId: string;
  action: QuickCaptureAction;
  state: QuickCaptureState;
  createdAt: number;
  expiresAt: number;
  clipboardText: string | null;
  target: QuickCaptureTarget | null;
  error: OperationError | null;
  dispatchAccepted: boolean;
}
export interface QuickCaptureUpdate {
  requestId: string;
  state: QuickCaptureState;
  target?: QuickCaptureTarget;
  error?: OperationError;
}
export interface QuickCaptureApi {
  checkTarget: (requestId: string, target: QuickCaptureTarget) => Promise<OperationResult<{ ready: true }>>;
  pending: () => Promise<OperationResult<QuickCaptureRequest | null>>;
  update: (request: QuickCaptureUpdate) => Promise<OperationResult<QuickCaptureRequest>>;
  onRequested: (listener: (event: { requestId: string; action: QuickCaptureAction; createdAt: number }) => void) => () => void;
}

export interface OperationError { code: string; message: string; retryable: boolean }
export type OperationResult<T> = { ok: true; value: T } | { ok: false; error: OperationError };
export interface ConversationRef { projectId: string; conversationKey: string }
/** Main resolves the logical identity from this persisted source before restarting an agent. */
export interface SessionResumeSource { projectId: string; runtimeSessionId: string }
export type HistoryScope = { kind: "all" } | { kind: "space"; spaceId: string } | { kind: "projects"; projectIds: string[] };
export type HistoryMode = "keyword" | "semantic" | "hybrid";
export interface HistorySearchRequest {
  requestId: string;
  query: string;
  scope: HistoryScope;
  mode: HistoryMode;
  sort: "recent" | "relevance";
  engines: EngineId[];
  from: number | null;
  to: number | null;
  includeArchived: boolean;
  limit: number;
  cursor: string | null;
}
export type TimestampQuality = "exact" | "session_time" | "unknown";
export interface HistoryLocation extends ConversationRef {
  runtimeSessionId: string;
  messageId: string | null;
  spaceId: string | null;
}
export interface HistoryHit extends HistoryLocation {
  hitId: string;
  kind: "session" | "message";
  projectName: string;
  spaceName: string | null;
  engine: EngineId;
  agentId: string | null;
  sessionTitle: string;
  archived: boolean;
  timestamp: number | null;
  timestampQuality: TimestampQuality;
  snippet: string;
  matchRanges: Array<{ start: number; end: number }>;
  matchSources: Array<"title" | "keyword" | "semantic">;
}
export interface HistoryCoverage {
  discovered: number;
  indexed: number;
  skipped: number;
  failed: number;
  keywordComplete: boolean;
  semanticIndexed: number;
  semanticComplete: boolean;
}
export interface HistorySearchResponse {
  requestId: string;
  generation: number;
  backend: "sqlite" | "scan";
  modeUsed: HistoryMode;
  hits: HistoryHit[];
  nextCursor: string | null;
  rankingWindow: number | null;
  warnings: OperationError[];
  coverage: HistoryCoverage;
}
export type HistoryEntryKind = "title" | "user" | "assistant" | "tool" | "system" | "summary";
export interface HistoryTimelineRequest {
  requestId: string;
  scope: HistoryScope;
  engines: EngineId[];
  includeArchived: boolean;
  from: number | null;
  to: number | null;
  unknownTime: boolean;
  limit: number;
  cursor: string | null;
}
export interface HistoryTimelineItem extends HistoryHit { interaction: Exclude<HistoryEntryKind, "title"> }
export interface HistoryTimelineResponse {
  requestId: string;
  generation: number;
  items: HistoryTimelineItem[];
  nextCursor: string | null;
  coverage: HistoryCoverage;
  warnings: OperationError[];
}
export interface HistoryActivityRequest {
  requestId: string;
  scope: HistoryScope;
  engines: EngineId[];
  includeArchived: boolean;
  fromDate: string;
  toDate: string;
  timeZone: string;
}
export interface HistoryActivityResponse {
  requestId: string;
  generation: number;
  days: Array<{ date: string; count: number }>;
  unknownUserCount: number;
  coverage: HistoryCoverage;
  warnings: OperationError[];
}
export interface HistoryIndexStatus {
  seq: number;
  generation: number;
  backend: "sqlite" | "scan";
  state: "idle" | "indexing" | "rebuilding" | "error";
  coverage: HistoryCoverage;
  warnings: OperationError[];
  updatedAt: number | null;
  semanticState: "disabled" | "preparing" | "indexing" | "ready" | "paused" | "error";
  semanticProgress: { indexedEntries: number; totalEntries: number; failedEntries: number; modelKey: string | null;
    download: { file: string; loaded: number; total: number | null } | null; error: OperationError | null };
}
export interface HistoryApi {
  search: (request: HistorySearchRequest) => Promise<OperationResult<HistorySearchResponse>>;
  timeline: (request: HistoryTimelineRequest) => Promise<OperationResult<HistoryTimelineResponse>>;
  activity: (request: HistoryActivityRequest) => Promise<OperationResult<HistoryActivityResponse>>;
  resolve: (location: HistoryLocation) => Promise<OperationResult<HistoryLocation>>;
  cancel: (requestId: string) => Promise<void>;
  status: () => Promise<OperationResult<HistoryIndexStatus>>;
  rebuild: (kind?: "keyword" | "all") => Promise<OperationResult<HistoryIndexStatus>>;
  cancelRebuild: () => Promise<OperationResult<HistoryIndexStatus>>;
  semanticControl: (action: "pause" | "resume" | "clear") => Promise<OperationResult<HistoryIndexStatus>>;
  onStatus: (listener: (status: HistoryIndexStatus) => void) => () => void;
}
export type BatchAction = "archive" | "delete" | "exportMarkdown";
export type BatchItemState = "pending" | "running" | "succeeded" | "failed" | "skipped" | "cancelled";
export interface BatchItem extends ConversationRef {
  runtimeSessionId: string;
  title: string;
  state: BatchItemState;
  error: OperationError | null;
  outputPath: string | null;
}
export interface BatchPreparation {
  prepareId: string;
  purpose: "freeze" | "flush";
  targets: ConversationRef[];
  expiresAt: number;
}
export interface BatchJob {
  jobId: string;
  requestId: string;
  action: BatchAction;
  state: "preparing" | "running" | "completed" | "partially_failed" | "failed" | "cancelled";
  seq: number;
  items: BatchItem[];
  preparation: BatchPreparation | null;
  createdAt: number;
  completedAt: number | null;
}
export interface BatchStartRequest { requestId: string; action: BatchAction; targets: ConversationRef[] }
export interface BatchPreparedRequest {
  jobId: string;
  prepareId: string;
  results: Array<ConversationRef & { ok: boolean; error?: string; inProgress?: boolean }>;
}

export interface SessionBatchApi {
  recoveries: () => Promise<OperationResult<BatchJob[]>>;
  start: (request: BatchStartRequest) => Promise<OperationResult<BatchJob>>;
  status: (jobId: string) => Promise<OperationResult<BatchJob>>;
  cancel: (jobId: string) => Promise<OperationResult<BatchJob>>;
  prepared: (request: BatchPreparedRequest) => Promise<OperationResult<BatchJob>>;
  onProgress: (listener: (job: BatchJob) => void) => () => void;
  onPrepare: (listener: (job: BatchJob) => void) => () => void;
}
