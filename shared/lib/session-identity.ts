import type { EngineId } from "../types/engine";

export interface SessionIdentity {
  projectId: string;
  id: string;
  engine?: EngineId;
  conversationId?: string;
  codexThreadId?: string;
}

/** Stable across runtime restarts; tuple encoding also avoids separator collisions. */
export function conversationKey(session: SessionIdentity): string {
  const engine = session.engine ?? "claude";
  const identity = engine === "codex" && session.codexThreadId
    ? session.codexThreadId
    : session.conversationId ?? session.id;
  return JSON.stringify([session.projectId, engine, identity]);
}
