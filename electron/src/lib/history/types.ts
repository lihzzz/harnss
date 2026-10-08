import type { EngineId } from "@shared/types/engine";
import type { HistoryEntryKind, HistoryCoverage, TimestampQuality, OperationError } from "@shared/types/productivity";

export interface HistoryProject { id: string; name: string; spaceId: string }
export interface HistoryCatalog { projects: HistoryProject[]; spaces: Array<{ id: string; name: string }> }
export interface HistoryEntry {
  entryKey: string;
  messageId: string | null;
  kind: HistoryEntryKind;
  sourceOrder: number;
  timestamp: number | null;
  timestampQuality: TimestampQuality;
  displayText: string;
  searchText: string;
  contentHash: string;
  isComplete: boolean;
}
export interface HistoryConversation {
  conversationKey: string;
  projectId: string;
  runtimeSessionId: string;
  engine: EngineId;
  agentId: string | null;
  title: string;
  archived: boolean;
  createdAt: number | null;
  lastMessageAt: number;
  modifiedAt: number;
  sourceRevision: string;
  entries: HistoryEntry[];
  damagedLines: number;
}
export interface HistorySnapshot {
  conversations: Map<string, HistoryConversation>;
  coverage: HistoryCoverage;
  warnings: OperationError[];
  signature: string;
}
export const emptyCoverage = (): HistoryCoverage => ({ discovered: 0, indexed: 0, skipped: 0, failed: 0, keywordComplete: false, semanticIndexed: 0, semanticComplete: false });
