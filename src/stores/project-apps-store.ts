import { create } from "zustand";
import type { AppEvent } from "@shared/types/project-apps";
import { reportError } from "@/lib/analytics/analytics";
import { EMPTY_APP_SNAPSHOT, reduceAppEvent, unwrapAppResult, type AppViewSnapshot } from "@/components/apps/app-utils";

interface ProjectAppsState { snapshot: AppViewSnapshot; loading: boolean; error: string | null }
export const useProjectAppsStore = create<ProjectAppsState>(() => ({ snapshot: EMPTY_APP_SNAPSHOT, loading: true, error: null }));
let consumers = 0;
let unsubscribe: (() => void) | null = null;
function accept(event: AppEvent): void {
  if (event.kind === "logs") return;
  useProjectAppsStore.setState((state) => ({ snapshot: reduceAppEvent(state.snapshot, event) }));
}
export async function refreshProjectApps(): Promise<void> {
  try {
    const snapshot = unwrapAppResult(await window.claude.projectApps.list());
    accept({ kind: "catalog", snapshot });
    useProjectAppsStore.setState({ loading: false, error: null });
  } catch (error) {
    useProjectAppsStore.setState({ loading: false, error: reportError("project-apps:list", error) });
  }
}
export function connectProjectApps(): () => void {
  consumers += 1;
  if (consumers === 1) {
    // Subscribe before taking a snapshot; revision checks discard late stale responses.
    unsubscribe = window.claude.projectApps.onEvent(accept);
    void refreshProjectApps();
  }
  return () => { consumers -= 1; if (consumers === 0) { unsubscribe?.(); unsubscribe = null; } };
}
