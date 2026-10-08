import type { AttentionItem, AttentionPriority, ChatSession, ExecutionPhase } from "@/types";

const priorityRank: Record<AttentionPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

export function getAttentionPriority(item: Pick<AttentionItem, "priority" | "updatedAt">): number {
  return priorityRank[item.priority ?? "normal"];
}

/** Translate persisted session flags into a small, user-facing execution state. */
export function deriveExecutionPhase(session: Pick<ChatSession, "isProcessing" | "hasPendingPermission" | "hasUnreadCompletion" | "codexGoal">): ExecutionPhase {
  if (session.hasPendingPermission) return "waiting_permission";
  if (session.codexGoal?.status === "blocked") return "blocked";
  if (session.isProcessing) return "running";
  if (session.hasUnreadCompletion) return "completed";
  return "idle";
}

/** Derive durable inbox entries from the session metadata available to the renderer. */
export function deriveAttentionItems(sessions: ChatSession[], now = Date.now()): AttentionItem[] {
  const items = sessions.flatMap((session) => {
    const conversationId = session.conversationId ?? session.id;
    const base = {
      conversationId,
      sessionId: session.id,
      projectId: session.projectId,
      createdAt: session.createdAt,
      updatedAt: session.lastMessageAt ?? session.createdAt,
    };
    const entries: AttentionItem[] = [];
    if (session.hasPendingPermission) {
      entries.push({
        ...base,
        id: `permission:${conversationId}`,
        title: "Permission required",
        summary: "The agent is waiting for approval before it can continue.",
        kind: "permission",
        status: "open",
        priority: "critical",
        phase: "waiting_permission",
        actionLabel: "Review permission",
        isBlocking: true,
        updatedAt: now,
      });
    }
    if (session.hasUnreadCompletion && !session.isProcessing) {
      entries.push({
        ...base,
        id: `result:${conversationId}`,
        title: "Result ready to review",
        summary: "The agent finished a turn while this session was in the background.",
        kind: "result",
        status: "open",
        priority: "normal",
        phase: "completed",
        actionLabel: "Open result",
        updatedAt: session.lastMessageAt ?? now,
      });
    }
    if (session.codexGoal?.status === "blocked" || session.codexGoal?.status === "usageLimited" || session.codexGoal?.status === "budgetLimited") {
      const blocked = session.codexGoal.status === "blocked";
      entries.push({
        ...base,
        id: `goal:${conversationId}`,
        title: blocked ? "Goal blocked" : "Goal limit reached",
        summary: session.codexGoal.objective,
        kind: "error",
        status: "open",
        priority: blocked ? "high" : "normal",
        phase: blocked ? "blocked" : "failed",
        actionLabel: blocked ? "Resolve blocker" : "Review goal",
        isBlocking: blocked,
        updatedAt: session.codexGoal.updatedAt,
      });
    }
    return entries;
  });

  return items.sort((a, b) => getAttentionPriority(a) - getAttentionPriority(b) || b.updatedAt - a.updatedAt);
}
