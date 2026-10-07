import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { conversationKey } from "@shared/lib/session-identity";
import type { BatchJob, BatchPreparedRequest } from "@shared/types/productivity";
import { buildPersistedSession } from "@/lib/session/records";
import { saveSessionSmart, invalidatePersistedCursor } from "@/lib/session/persistence";
import { freezeSession, getBatchJobs, getLiveSnapshot, isSessionFrozen, isSessionRecovering, releaseSession, rememberBatchJob, subscribeBatchJobs } from "@/lib/session/batch-runtime";
import { bgAgentStore } from "@/lib/background/agent-store";
import { suppressNextSessionCompletion } from "@/lib/notification-utils";
import { reportError } from "@/lib/analytics/analytics";
import type { SharedSessionRefs, SharedSessionSetters } from "./types";

const preparations = new Map<string, Promise<BatchPreparedRequest["results"]>>();
const acknowledged = new Set<string>();
const appliedItems = new Set<string>();

export function useSessionBatch(refs: SharedSessionRefs, setters: SharedSessionSetters, evictFromCache: (id: string) => void): void {
  const current = useRef({ refs, setters, evictFromCache });
  current.current = { refs, setters, evictFromCache };
  useEffect(() => {
    const prepare = async (job: BatchJob) => {
      const request = job.preparation;
      if (!request || acknowledged.has(request.prepareId)) return;
      // Mark before awaiting: store updates may synchronously deliver this same preparation again.
      acknowledged.add(request.prepareId);
      let pending = preparations.get(request.prepareId);
      if (!pending) {
        pending = (async () => {
          const results: BatchPreparedRequest["results"] = [];
          for (const target of request.targets) {
            const { refs } = current.current;
            const matches = refs.sessionsRef.current.filter((session) => conversationKey(session) === target.conversationKey && session.projectId === target.projectId);
            const session = matches[0];
            if (!session && request.purpose === "freeze") {
              // A recovered deletion may have no source file or mounted pane left.
              const item = job.items.find((item) => item.conversationKey === target.conversationKey);
              if (item?.runtimeSessionId) freezeSession(item.runtimeSessionId, job.jobId);
              results.push({ ...target, ok: true });
              continue;
            }
            if (!session) { results.push({ ...target, ok: false, error: "Conversation is no longer loaded" }); continue; }
            try {
              if (request.purpose === "freeze") {
                for (const match of matches) { freezeSession(match.id, job.jobId); suppressNextSessionCompletion(match.id); }
              } else {
                if (isSessionFrozen(session.id)) throw new Error("Conversation is being deleted");
                if (isSessionRecovering(session.id)) throw new Error("Conversation is still being restored; retry after it is ready");
                let snapshot = getLiveSnapshot(session.id);
                if (session.id === refs.activeSessionIdRef.current) {
                  snapshot = { data: buildPersistedSession(session, refs.messagesRef.current.filter((message) => !message.isQueued), refs.totalCostRef.current, refs.contextUsageRef.current), inProgress: refs.isProcessingRef.current };
                } else if (!snapshot) {
                  const state = refs.backgroundStoreRef.current.get(session.id);
                  if (state) snapshot = { data: buildPersistedSession(session, state.messages.filter((message) => !message.isQueued), state.totalCost, state.contextUsage), inProgress: state.isProcessing };
                  else if (refs.liveSessionIdsRef.current.has(session.id) || refs.visibleSplitSessionIdsRef.current.includes(session.id)) throw new Error("The live pane is not ready to save a snapshot");
                }
                if (snapshot) await saveSessionSmart(snapshot.data);
                results.push({ ...target, ok: true, inProgress: snapshot?.inProgress ?? false });
                continue;
              }
              results.push({ ...target, ok: true });
            } catch (error) {
              const message = reportError("SESSIONS:BATCH_PREPARE_ERR", error);
              results.push({ ...target, ok: false, error: message });
            }
          }
          return results;
        })();
        preparations.set(request.prepareId, pending);
      }
      try {
        const result = await window.claude.sessions.batch.prepared({ jobId: job.jobId, prepareId: request.prepareId, results: await pending });
        if (result.ok) rememberBatchJob(result.value);
        else {
          const status = await window.claude.sessions.batch.status(job.jobId);
          if (status.ok) rememberBatchJob(status.value);
          else toast.error(result.error.message);
        }
      } catch (error) {
        acknowledged.delete(request.prepareId);
        reportError("SESSIONS:BATCH_ACK_ERR", error);
      }
    };
    const applyJobs = () => {
      const { refs, setters, evictFromCache } = current.current;
      for (const job of getBatchJobs()) {
        if (job.preparation) void prepare(job);
        for (const item of job.items) {
          if (item.state === "pending" || item.state === "running") continue;
          const appliedId = `${job.jobId}:${item.conversationKey}`;
          if (appliedItems.has(appliedId)) continue;
          appliedItems.add(appliedId);
          const succeeded = item.state === "succeeded" || item.error?.code === "ALREADY_DELETED";
          const deletionBlocked = succeeded || item.error?.code === "DELETE_INCOMPLETE";
          const deletionState = item.error?.code === "DELETE_INCOMPLETE" ? "pending" : item.error?.code === "STOP_FAILED" ? "available" : undefined;
          const matches = refs.sessionsRef.current.filter((session) => conversationKey(session) === item.conversationKey && session.projectId === item.projectId);
          if (job.action === "delete" && !matches.length && item.runtimeSessionId) releaseSession(item.runtimeSessionId, job.jobId, succeeded, deletionState);
          for (const session of matches) {
            if (job.action === "delete") releaseSession(session.id, job.jobId, succeeded, deletionState);
            if (job.action === "delete" && deletionBlocked) {
              evictFromCache(session.id);
              refs.liveSessionIdsRef.current.delete(session.id);
              refs.messageQueueRef.current.delete(session.id);
              refs.backgroundStoreRef.current.delete(session.id);
              bgAgentStore.clearSession(session.id);
              invalidatePersistedCursor(session.id);
              toast.dismiss(`permission-${session.id}`);
              if (refs.activeSessionIdRef.current === session.id) {
                refs.activeSessionIdRef.current = null;
                setters.setActiveSessionId(null);
                setters.setInitialMessages([]);
                setters.setInitialMeta(null);
                setters.setInitialPermission(null);
                setters.setInitialRawAcpPermission(null);
              }
            }
          }
          if (succeeded && job.action === "delete") setters.setSessions((sessions) => sessions.filter((session) => conversationKey(session) !== item.conversationKey));
          else if (job.action === "delete" && deletionBlocked) setters.setSessions((sessions) => sessions.map((session) => conversationKey(session) === item.conversationKey ? { ...session, isProcessing: false, isActive: false } : session));
          if (succeeded && job.action === "archive") setters.setSessions((sessions) => sessions.map((session) => conversationKey(session) === item.conversationKey ? { ...session, archived: true } : session));
        }
      }
    };
    const unsubscribeStore = subscribeBatchJobs(applyJobs);
    const unsubscribeProgress = window.claude.sessions.batch.onProgress(rememberBatchJob);
    const unsubscribePrepare = window.claude.sessions.batch.onPrepare((job) => { rememberBatchJob(job); void prepare(job); });
    void window.claude.sessions.batch.recoveries().then((result) => {
      if (result.ok) for (const job of result.value) rememberBatchJob(job);
      else toast.error(result.error.message);
    }).catch((error) => { toast.error(reportError("SESSIONS:RECOVERY_ERR", error)); });
    for (const job of getBatchJobs()) if (job.completedAt === null) void window.claude.sessions.batch.status(job.jobId).then((result) => { if (result.ok) rememberBatchJob(result.value); }).catch((error) => reportError("SESSIONS:BATCH_STATUS_ERR", error));
    applyJobs();
    return () => { unsubscribeStore(); unsubscribeProgress(); unsubscribePrepare(); };
  }, []);
}
