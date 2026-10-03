import type { Dispatch, SetStateAction } from "react";
import type { UIMessage, SessionInfo } from "./session";
import type { PermissionRequest } from "./permissions";
import type { ContextUsage } from "./mcp";
import type { RespondPermissionFn } from "../../shared/types/engine";
import type { CodexThreadGoal } from "./codex";

/** Metadata snapshot for restoring a session from the background store. */
export interface BackgroundSessionSnapshot {
  isProcessing: boolean;
  isConnected: boolean;
  sessionInfo: SessionInfo | null;
  totalCost: number;
  contextUsage: ContextUsage | null;
  isCompacting?: boolean;
  codexGoal?: CodexThreadGoal | null;
  codexGoalSupported?: boolean | null;
  /** Upstream reconnect in progress (Codex willRetry) — transient, not persisted. */
  reconnectMessage?: string | null;
}

/**
 * The contract every engine hook must fulfill.
 * useSessionManager consumes this interface — it never touches engine internals directly.
 */
export interface EngineHookState {
  messages: UIMessage[];
  setMessages: Dispatch<SetStateAction<UIMessage[]>>;
  isProcessing: boolean;
  setIsProcessing: Dispatch<SetStateAction<boolean>>;
  isConnected: boolean;
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  totalCost: number;
  setTotalCost: Dispatch<SetStateAction<number>>;
  contextUsage: ContextUsage | null;
  isCompacting?: boolean;
  /** Upstream reconnect in progress (Codex willRetry retries) — shown as a chat status row. */
  reconnectMessage?: string | null;
  pendingPermission: PermissionRequest | null;
  respondPermission: RespondPermissionFn;
}
