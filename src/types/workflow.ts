import type { EngineId } from "./engine";

/** A stable logical conversation id. Runtime session ids may change on revive/fork. */
export interface ConversationRef {
  conversationId: string;
  sessionId: string;
  projectId: string;
}

export type AttentionKind = "permission" | "question" | "error" | "result" | "review" | "handoff" | "blocked" | "waiting_input";
export type AttentionStatus = "open" | "read" | "resolved" | "dismissed";
export type AttentionPriority = "critical" | "high" | "normal" | "low";
export type ExecutionPhase =
  | "idle"
  | "running"
  | "waiting_permission"
  | "waiting_user"
  | "blocked"
  | "completed"
  | "failed";

export interface AttentionItem {
  id: string;
  conversationId: string;
  sessionId: string;
  projectId: string;
  title: string;
  summary: string;
  kind: AttentionKind;
  status: AttentionStatus;
  priority?: AttentionPriority;
  phase?: ExecutionPhase;
  actionLabel?: string;
  isBlocking?: boolean;
  createdAt: number;
  updatedAt: number;
  runId?: string;
}

export interface ReviewRange {
  start: number;
  end: number;
}

export interface ReviewComment {
  id: string;
  snapshotId: string;
  conversationId?: string;
  filePath: string;
  group?: "staged" | "unstaged" | "untracked";
  side: "old" | "new";
  range: ReviewRange;
  selectedText: string;
  body: string;
  category: "problem" | "suggestion" | "question";
  status: "draft" | "pending" | "sent" | "needs_review" | "resolved" | "dismissed";
  createdAt: number;
  updatedAt: number;
  sourceHash?: string;
}

export interface ReviewSnapshot {
  id: string;
  conversationId: string;
  projectId: string;
  cwd: string;
  scope: "working-tree" | "branch" | "last-turn";
  baseRef?: string;
  createdAt: number;
  files: Array<{ path: string; group?: "staged" | "unstaged" | "untracked"; hash?: string; diff: string }>;
}

export type HandoffPurpose = "review" | "fix" | "continue";

export interface HandoffRecord {
  id: string;
  sourceConversationId: string;
  sourceSessionId: string;
  targetConversationId?: string;
  targetSessionId?: string;
  projectId: string;
  sourceEngine: EngineId;
  targetEngine: EngineId;
  purpose: HandoffPurpose;
  objective: string;
  constraints: string;
  verification: string;
  commentIds: string[];
  snapshotId?: string;
  status: "draft" | "ready" | "started" | "completed" | "failed";
  error?: string;
  createdAt: number;
  updatedAt: number;
}
