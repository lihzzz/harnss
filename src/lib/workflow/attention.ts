import type { AttentionItem, ChatSession } from "@/types";

/** Derive durable inbox entries from the session metadata available to the renderer. */
export function deriveAttentionItems(sessions: ChatSession[], now = Date.now()): AttentionItem[] {
  return sessions.flatMap((session) => {
    const conversationId = session.conversationId ?? session.id;
    const base = { conversationId, sessionId: session.id, projectId: session.projectId, createdAt: session.createdAt, updatedAt: session.lastMessageAt ?? session.createdAt };
    const items: AttentionItem[] = [];
    if (session.hasPendingPermission) {
      items.push({ ...base, id: `permission:${conversationId}`, title: "Permission required", summary: "The agent is waiting for approval before it can continue.", kind: "permission", status: "open", updatedAt: now });
    }
    if (session.hasUnreadCompletion && !session.isProcessing) {
      items.push({ ...base, id: `result:${conversationId}`, title: "Result ready to review", summary: "The agent finished a turn while this session was in the background.", kind: "result", status: "open", updatedAt: session.lastMessageAt ?? now });
    }
    if (session.codexGoal?.status === "blocked" || session.codexGoal?.status === "usageLimited" || session.codexGoal?.status === "budgetLimited") {
      items.push({ ...base, id: `goal:${conversationId}`, title: session.codexGoal.status === "blocked" ? "Goal blocked" : "Goal limit reached", summary: session.codexGoal.objective, kind: "error", status: "open", updatedAt: session.codexGoal.updatedAt });
    }
    return items;
  });
}
