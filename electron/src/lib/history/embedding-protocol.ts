import type { OperationResult } from "@shared/types/productivity";
import type { HistoryChunk } from "./chunks";

export type EmbeddingCommand = { action: "chunks"; text: string } | { action: "embed"; texts: string[]; kind: "query" | "passage" };
export type EmbeddingRequest = { id: string } & EmbeddingCommand;
export type EmbeddingValue = { chunks: HistoryChunk[] } | { vectors: Float32Array[] };
export interface ModelDownloadProgress { file: string; loaded: number; total: number | null }
export type EmbeddingReply = { type: "reply"; id: string; result: OperationResult<EmbeddingValue> }
  | { type: "download"; progress: ModelDownloadProgress };
