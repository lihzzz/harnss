import { describe, expect, it } from "vitest";
import type { ChatSession, UIMessage } from "@/types";
import { extractSessionMeta } from "@shared/lib/session-persistence";
import { buildPersistedSession, toChatSession } from "./records";

describe("session records", () => {
  it("keeps the ACP session ID in sidebar metadata", () => {
    const meta = extractSessionMeta({
      id: "session-1",
      projectId: "project-1",
      title: "OpenCode chat",
      createdAt: 100,
      engine: "acp",
      agentId: "opencode",
      agentSessionId: "ses_test",
    }, 200);

    expect(meta.agentSessionId).toBe("ses_test");
  });

  it("keeps folder, pin, archive, and branch metadata when hydrating sidebar sessions", () => {
    const session = toChatSession({
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      lastMessageAt: 200,
      totalCost: 12,
      engine: "claude",
      agentSessionId: "ses_test",
      folderId: "folder-1",
      pinned: true,
      archived: true,
      branch: "feature/test",
    }, false);

    expect(session.folderId).toBe("folder-1");
    expect(session.pinned).toBe(true);
    expect(session.archived).toBe(true);
    expect(session.branch).toBe("feature/test");
    expect(session.agentSessionId).toBe("ses_test");
    expect(session.isActive).toBe(false);
  });

  it("keeps folder, pin, archive, and branch metadata when building persisted sessions", () => {
    const session: ChatSession = {
      id: "session-1",
      projectId: "project-1",
      title: "Chat",
      createdAt: 100,
      totalCost: 12,
      isActive: true,
      engine: "claude",
      agentSessionId: "ses_test",
      folderId: "folder-1",
      pinned: true,
      archived: true,
      branch: "feature/test",
    };
    const messages: UIMessage[] = [{
      id: "message-1",
      role: "user",
      content: "hi",
      timestamp: 101,
    }];

    const persisted = buildPersistedSession(session, messages, 12, null);

    expect(persisted.folderId).toBe("folder-1");
    expect(persisted.pinned).toBe(true);
    expect(persisted.archived).toBe(true);
    expect(persisted.branch).toBe("feature/test");
    expect(persisted.agentSessionId).toBe("ses_test");
    expect(persisted.messages).toEqual(messages);
  });
});
