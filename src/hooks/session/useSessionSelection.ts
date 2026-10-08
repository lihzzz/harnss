import { useCallback, useRef, useState } from "react";

export const MAX_SELECTED_SESSIONS = 500;

/** Range selection uses the caller's visible order; selected IDs survive unmounts. */
export function selectSessionRange(selected: ReadonlySet<string>, visible: readonly string[], anchor: string | null, target: string, range: boolean): Set<string> {
  const next = new Set(selected);
  const from = anchor ? visible.indexOf(anchor) : -1;
  const to = visible.indexOf(target);
  const targets = range && from >= 0 && to >= 0 ? visible.slice(Math.min(from, to), Math.max(from, to) + 1) : [target];
  const remove = !range && next.has(target);
  for (const id of targets) {
    if (remove) next.delete(id);
    else if (next.size < MAX_SELECTED_SESSIONS) next.add(id);
  }
  return next;
}

export function useSessionSelection(visibleOrder: () => string[]) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const toggle = useCallback((id: string, range: boolean) => {
    const visible = visibleOrder();
    const previousAnchor = anchor.current;
    setSelected((previous) => selectSessionRange(previous, visible, previousAnchor, id, range));
    anchor.current = id;
  }, [visibleOrder]);
  const clear = useCallback(() => { setSelected(new Set()); setActive(false); anchor.current = null; }, []);
  const selectVisible = useCallback(() => setSelected(new Set(visibleOrder().slice(0, MAX_SELECTED_SESSIONS))), [visibleOrder]);
  return { active, setActive, selected, setSelected, toggle, clear, selectVisible };
}
