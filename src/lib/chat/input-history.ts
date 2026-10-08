import type { UIMessage } from "@/types";

/** Remove internal context blocks from user messages created by file mentions or browser grabs. */
export function stripInputContext(text: string): string {
  let result = text.replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "");
  result = result.replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "");
  result = result.replace(/<element [^>]*>[\s\S]*?<\/element>\s*/g, "");
  return result.trim();
}

function stripInputDecorations(text: string): string {
  return text.replace(/\s*\[\[element:[^\]]+\]\]/g, "").trim();
}

/** Return the user-entered prompts for a session in chronological order. */
export function getInputHistory(messages: UIMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") return [];
    const displayContent = message.displayContent?.trim();
    const prompt = stripInputDecorations(
      displayContent || stripInputContext(message.content),
    );
    return prompt ? [prompt] : [];
  });
}

/** Allow arrow-key navigation to continue while the composer shows a history entry. */
export function canNavigateInputHistory({
  currentText,
  history,
  currentIndex,
  isEmpty,
  atBoundary,
}: {
  currentText: string;
  history: readonly string[];
  currentIndex: number;
  isEmpty: boolean;
  atBoundary: boolean;
}): boolean {
  const isCurrentHistoryEntry =
    currentIndex >= 0 &&
    currentIndex < history.length &&
    currentText === history[currentIndex];
  return isEmpty || isCurrentHistoryEntry || atBoundary;
}

// ── Persistent cross-session input history (per project) ──

const INPUT_HISTORY_LIMIT = 50;
const INPUT_HISTORY_KEY_PREFIX = "harnss-input-history-";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Load the persisted prompt history for a project (oldest first). */
export function loadPersistedInputHistory(
  projectPath: string | undefined,
  storage: StorageLike | null = defaultStorage(),
): string[] {
  if (!projectPath || !storage) return [];
  try {
    const raw = storage.getItem(`${INPUT_HISTORY_KEY_PREFIX}${projectPath}`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  } catch {
    return [];
  }
}

/** Append a sent prompt to the project's persisted history (capped, consecutive duplicates removed). */
export function appendPersistedInputHistory(
  projectPath: string | undefined,
  prompt: string,
  storage: StorageLike | null = defaultStorage(),
): void {
  const entry = prompt.trim();
  if (!projectPath || !entry || !storage) return;
  const existing = loadPersistedInputHistory(projectPath, storage);
  if (existing[existing.length - 1] !== entry) existing.push(entry);
  const trimmed = existing.slice(-INPUT_HISTORY_LIMIT);
  try {
    storage.setItem(`${INPUT_HISTORY_KEY_PREFIX}${projectPath}`, JSON.stringify(trimmed));
  } catch {
    // storage full or unavailable — history persistence is best-effort
  }
}

/**
 * Merge persisted cross-session history with the current session's prompts.
 * Prompts sent in this session were already persisted on send, so the session
 * list typically appears as a suffix of the persisted list; avoid duplicating
 * that overlap. Consecutive duplicates in the result are collapsed so arrow-key
 * navigation never appears stuck on one entry.
 */
export function mergeInputHistory(
  persisted: readonly string[],
  session: readonly string[],
): string[] {
  let overlap = 0;
  for (let size = Math.min(persisted.length, session.length); size > 0; size--) {
    let matches = true;
    for (let i = 0; i < size; i++) {
      if (persisted[persisted.length - size + i] !== session[session.length - size + i]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      overlap = size;
      break;
    }
  }
  const merged = [...persisted, ...session.slice(0, session.length - overlap)];
  return merged.filter((entry, index) => index === 0 || entry !== merged[index - 1]);
}
