export interface QuickCaptureComposer {
  focus: () => boolean;
  hasDraft: () => boolean;
  dictate: () => Promise<void>;
  /** Insert user-reviewable context only when this composer has no unsent draft. */
  insertDraft?: (text: string) => boolean;
}

const composers = new Map<string, QuickCaptureComposer>();

/** Register the actual composer instance; routing never guesses a textbox from the DOM. */
export function registerQuickCaptureComposer(id: string, composer: QuickCaptureComposer): () => void {
  composers.set(id, composer);
  return () => { if (composers.get(id) === composer) composers.delete(id); };
}
export function getQuickCaptureComposer(id: string | null): QuickCaptureComposer | undefined { return id ? composers.get(id) : undefined; }
export function hasUnsentComposerDraft(): boolean { return [...composers.values()].some((composer) => composer.hasDraft()); }
