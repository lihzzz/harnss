/**
 * useBackgroundReaper — caps the number of live background engine processes.
 *
 * Every background session keeps its engine process alive (measured 100-130MB RSS
 * each for codex app-server; Claude CLI node processes are similar), and processes
 * used to live until app quit. When the number of live background sessions exceeds
 * `backgroundProcessLimit`, the least-recently-active idle sessions are persisted,
 * stopped, and removed from the background store. Switching back loads history from
 * disk; sending a message revives the engine via the existing revival paths.
 *
 * Guards: a session is never reaped while it is processing a turn or has a pending
 * permission request, and the active/visible-split/draft sessions are protected.
 */
import { useEffect } from "react";
import { DRAFT_ID } from "./types";
import type { SharedSessionRefs } from "./types";
import { buildPersistedSession } from "../../lib/session/records";
import { invalidatePersistedCursor, saveSessionSmart } from "../../lib/session/persistence";
import { suppressNextSessionCompletion } from "../../lib/notification-utils";
import { useSettingsStore } from "@/stores/settings-store";

const REAP_INTERVAL_MS = 60_000;

interface UseBackgroundReaperParams {
  refs: SharedSessionRefs;
}

export interface ReapCandidateInfo {
  sid: string;
  isProcessing: boolean;
  hasPendingPermission: boolean;
  lastActivityAt: number;
}

/**
 * Pure selection: which background session IDs to reap this pass.
 * Guards — never reap sessions that are mid-turn or awaiting a permission response;
 * protected IDs (active pane, split panes, drafts) never appear in the result.
 */
export function selectReapCandidates(
  liveBackgroundIds: string[],
  limit: number,
  info: (sid: string) => ReapCandidateInfo | undefined,
): string[] {
  if (!limit || limit <= 0) return [];
  const excess = liveBackgroundIds.length - limit;
  if (excess <= 0) return [];
  return liveBackgroundIds
    .map((sid) => info(sid))
    .filter((c): c is ReapCandidateInfo => !!c && !c.isProcessing && !c.hasPendingPermission)
    .sort((a, b) => a.lastActivityAt - b.lastActivityAt)
    .slice(0, excess)
    .map((c) => c.sid);
}

export function useBackgroundReaper({ refs }: UseBackgroundReaperParams): void {
  useEffect(() => {
    const reap = async () => {
      const limit = useSettingsStore.getState().backgroundProcessLimit;
      if (!limit || limit <= 0) return;

      const {
        activeSessionIdRef, visibleSplitSessionIdsRef, preStartedSessionIdRef,
        draftAcpSessionIdRef, liveSessionIdsRef, backgroundStoreRef, sessionsRef,
      } = refs;

      const protectedIds = new Set<string>();
      const active = activeSessionIdRef.current;
      if (active) protectedIds.add(active);
      protectedIds.add(DRAFT_ID);
      for (const sid of visibleSplitSessionIdsRef.current ?? []) protectedIds.add(sid);
      const preStarted = preStartedSessionIdRef.current;
      if (preStarted) protectedIds.add(preStarted);
      const draftAcp = draftAcpSessionIdRef.current;
      if (draftAcp) protectedIds.add(draftAcp);

      const backgroundLive = [...liveSessionIdsRef.current].filter((sid) => !protectedIds.has(sid));
      const reapIds = selectReapCandidates(backgroundLive, limit, (sid) => {
        const bg = backgroundStoreRef.current.get(sid);
        const session = sessionsRef.current.find((s) => s.id === sid);
        if (!bg || !session) return undefined;
        return {
          sid,
          isProcessing: bg.isProcessing,
          hasPendingPermission: !!bg.pendingPermission,
          lastActivityAt: session.lastMessageAt ?? session.createdAt ?? 0,
        };
      });

      for (const sid of reapIds) {
        const bgState = backgroundStoreRef.current.get(sid);
        const session = sessionsRef.current.find((s) => s.id === sid);
        if (!bgState || !session || bgState.isProcessing || bgState.pendingPermission) continue;

        // Persist latest background state before stopping the process.
        try {
          await saveSessionSmart(buildPersistedSession(
            {
              ...session,
              model: session.model || bgState.sessionInfo?.model,
              ...(session.engine === "codex" ? { codexGoal: bgState.codexGoal ?? null } : {}),
            },
            bgState.messages,
            bgState.totalCost,
            bgState.contextUsage,
          ));
        } catch {
          continue; // Don't reap a session we failed to persist.
        }

        suppressNextSessionCompletion(sid);
        if (session.engine === "codex") {
          await window.claude.codex.stop(sid).catch(() => undefined);
        } else if (session.engine === "acp") {
          await window.claude.acp.stop(sid).catch(() => undefined);
        } else {
          await window.claude.stop(sid, "background_reap").catch(() => undefined);
        }
        liveSessionIdsRef.current.delete(sid);
        backgroundStoreRef.current.delete(sid);
        invalidatePersistedCursor(sid);
      }
    };

    const timer = setInterval(() => void reap(), REAP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refs]);
}
