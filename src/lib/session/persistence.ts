import type { PersistedSession, UIMessage } from "@/types";
import { getLastUserMessageTimestamp } from "@shared/lib/session-persistence";
import { isSessionFrozen, isSessionRecovering, isSessionRetired, replaceSessionRuntime } from "./batch-runtime";

// ── Incremental persistence cursor ──
// Last successfully persisted message array per session (element references shared with
// live state — messages are immutably updated, so `!==` detects revisions). Lets the hot
// debounced save send only the delta via sessions:append instead of rewriting megabytes.
const persistedCursors = new Map<string, UIMessage[]>();
const CURSOR_LIMIT = 20;

function rememberCursor(sessionId: string, messages: UIMessage[]): void {
  persistedCursors.delete(sessionId);
  persistedCursors.set(sessionId, [...messages]);
  while (persistedCursors.size > CURSOR_LIMIT) {
    const oldest = persistedCursors.keys().next().value;
    if (oldest === undefined) break;
    persistedCursors.delete(oldest);
  }
}

/** Drop the incremental cursor for a session (deleted, or externally rewritten). */
export function invalidatePersistedCursor(sessionId: string): void {
  persistedCursors.delete(sessionId);
}

/**
 * Save a session, preferring an O(delta) append when only message tails/edits changed.
 * Falls back to a full save on structural changes (revert/retry/truncation), on first
 * save, or when the main process has no snapshot to append to.
 */
export async function saveSessionSmart(data: PersistedSession, previousSessionId?: string): Promise<void> {
  if (isSessionFrozen(data.id) || isSessionRetired(data.id) || (previousSessionId && isSessionFrozen(previousSessionId))) return;
  if (!previousSessionId && isSessionRecovering(data.id)) return;
  const messages = (data.messages ?? []) as UIMessage[];
  const prev = persistedCursors.get(data.id);

  let appendable = prev !== undefined && messages.length >= prev.length;
  if (appendable && prev) {
    for (let i = 0; i < prev.length; i++) {
      if (messages[i].id !== prev[i].id) { appendable = false; break; }
    }
  }

  if (appendable && prev) {
    const delta: UIMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      if (i >= prev.length || messages[i] !== prev[i]) delta.push(messages[i]);
    }
    const { messages: _messages, ...header } = data;
    const result = await window.claude.sessions.append({
      ...header,
      appendedMessages: delta,
      messageCount: messages.length,
      lastMessageAt: getLastUserMessageTimestamp(messages) ?? data.createdAt ?? 0,
    }, previousSessionId);
    if (!result.error) {
      rememberCursor(data.id, messages);
      return;
    }
    if (result.error !== "append-before-save") {
      throw new Error(result.error);
    }
    // No snapshot on disk yet — fall through to a full save.
  }

  if (isSessionFrozen(data.id) || isSessionRetired(data.id) || (previousSessionId && isSessionFrozen(previousSessionId))) throw new Error("Session is no longer available to save");
  const result = await window.claude.sessions.save(data, previousSessionId);
  if (result.error) throw new Error(result.error);
  rememberCursor(data.id, messages);
}

/** Save the new runtime's history before retiring its previous on-disk snapshot. */
export async function persistSessionReplacement(previousSessionId: string, data: PersistedSession): Promise<void> {
  if (isSessionFrozen(data.id) || isSessionFrozen(previousSessionId) || isSessionRetired(previousSessionId) || isSessionRetired(data.id)) throw new Error("Session is no longer available to replace");
  await saveSessionSmart(data, previousSessionId);
  replaceSessionRuntime(previousSessionId, data.id);
  if (previousSessionId !== data.id) invalidatePersistedCursor(previousSessionId);
}
