import type { AttentionItem, HandoffRecord, ReviewComment, ReviewSnapshot } from "@/types";

const STORAGE_KEY = "harnss-workflow-v1";

export interface WorkflowState {
  attention: AttentionItem[];
  snapshots: ReviewSnapshot[];
  comments: ReviewComment[];
  handoffs: HandoffRecord[];
}

const EMPTY: WorkflowState = { attention: [], snapshots: [], comments: [], handoffs: [] };

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string",
    )
    : [];
}

function read(): WorkflowState {
  if (typeof localStorage === "undefined") return { ...EMPTY };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<WorkflowState>;
    return {
      attention: records(parsed.attention) as unknown as AttentionItem[],
      snapshots: records(parsed.snapshots) as unknown as ReviewSnapshot[],
      comments: records(parsed.comments) as unknown as ReviewComment[],
      handoffs: records(parsed.handoffs) as unknown as HandoffRecord[],
    };
  } catch {
    return EMPTY;
  }
}

function write(state: WorkflowState): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createWorkflowStore() {
  let state = read();
  const listeners = new Set<() => void>();

  const update = (next: WorkflowState) => {
    state = next;
    write(state);
    listeners.forEach((listener) => listener());
  };

  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    upsertAttention(item: AttentionItem) {
      update({ ...state, attention: [...state.attention.filter((entry) => entry.id !== item.id), item] });
    },
    updateAttention(id: string, patch: Partial<AttentionItem>) {
      update({ ...state, attention: state.attention.map((item) => item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item) });
    },
    saveSnapshot(snapshot: ReviewSnapshot) {
      update({ ...state, snapshots: [...state.snapshots.filter((item) => item.id !== snapshot.id), snapshot] });
    },
    saveComment(comment: ReviewComment) {
      update({ ...state, comments: [...state.comments.filter((item) => item.id !== comment.id), comment] });
    },
    saveHandoff(handoff: HandoffRecord) {
      update({ ...state, handoffs: [...state.handoffs.filter((item) => item.id !== handoff.id), handoff] });
    },
    clear() {
      update({ ...EMPTY });
    },
  };
}

export const workflowStore = createWorkflowStore();

export function makeWorkflowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
