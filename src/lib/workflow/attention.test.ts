import { describe, expect, it } from "vitest";
import { deriveAttentionItems, deriveExecutionPhase } from "./attention";
import type { ChatSession } from "@/types";

const session = (patch: Partial<ChatSession> = {}): ChatSession => ({
  id: "runtime-1",
  conversationId: "conversation-1",
  projectId: "project-1",
  title: "Fix login",
  createdAt: 100,
  totalCost: 0,
  isActive: false,
  engine: "claude",
  ...patch,
});

describe("deriveAttentionItems", () => {
  it("creates one item for a pending permission and one for an unread result", () => {
    const items = deriveAttentionItems([session({ hasPendingPermission: true, hasUnreadCompletion: true })], 500);
    expect(items.map((item) => item.id)).toEqual(["permission:conversation-1", "result:conversation-1"]);
    expect(items.every((item) => item.conversationId === "conversation-1")).toBe(true);
  });

  it("surfaces blocked Codex goals as errors", () => {
    const items = deriveAttentionItems([session({ engine: "codex", codexGoal: {
      threadId: "thread-1", objective: "Ship it", status: "blocked", tokenBudget: null,
      tokensUsed: 10, timeUsedSeconds: 2, createdAt: 1, updatedAt: 20,
    } })]);
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("error");
    expect(items[0]?.title).toBe("Goal blocked");
    expect(items[0]?.priority).toBe("high");
    expect(items[0]?.isBlocking).toBe(true);
  });

  it("puts a permission request before a normal completion", () => {
    const items = deriveAttentionItems([
      session({ id: "done", conversationId: "done", hasUnreadCompletion: true, lastMessageAt: 900 }),
      session({ id: "approval", conversationId: "approval", hasPendingPermission: true, lastMessageAt: 100 }),
    ], 1_000);
    expect(items.map((item) => item.id)).toEqual(["permission:approval", "result:done"]);
  });

  it("derives the state a user needs to understand at a glance", () => {
    expect(deriveExecutionPhase(session({ isProcessing: true }))).toBe("running");
    expect(deriveExecutionPhase(session({ hasPendingPermission: true, isProcessing: true }))).toBe("waiting_permission");
    expect(deriveExecutionPhase(session({ hasUnreadCompletion: true }))).toBe("completed");
  });
});
