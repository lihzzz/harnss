import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { beginSessionRecovery, isSessionFrozen, isSessionRetired } from "@/lib/session/batch-runtime";
import type { ChatSession, EngineId, ImageAttachment, Project, UIMessage } from "../../types";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { buildSdkContent } from "../../lib/engine/protocol";
import { capture, reportError } from "../../lib/analytics/analytics";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { isRetryableUpstreamError } from "../../lib/session/retry";
import { buildPersistedSession } from "../../lib/session/records";
import { persistSessionReplacement } from "../../lib/session/persistence";
import { useI18n } from "@/lib/i18n";
import { DRAFT_ID, getEffectiveClaudePermissionMode, getCodexApprovalPolicy, getCodexSandboxMode, buildCodexCollabMode } from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks, InitialMeta } from "./types";

interface UseSessionRevivalParams {
  refs: Pick<SharedSessionRefs, "activeSessionIdRef" | "sessionsRef" | "messagesRef" | "totalCostRef" | "contextUsageRef" | "isProcessingRef" | "liveSessionIdsRef" | "backgroundStoreRef" | "messageQueueRef" | "startOptionsRef" | "codexEffortRef" | "acpAgentIdRef" | "acpAgentSessionIdRef">;
  setters: Pick<SharedSessionSetters, "setSessions" | "setActiveSessionId" | "setInitialMessages" | "setInitialMeta" | "setInitialConfigOptions" | "setAcpMcpStatuses" | "setQueuedCount">;
  engines: { [K in "claude" | "acp" | "codex"]: Pick<EngineHooks[K], "setMessages" | "setIsProcessing" | "isReadyForSession"> };
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

/** One owner for the whole restore → save → mount → send sequence. */
export function useSessionRevival({ refs, setters, engines, findProject, getProjectCwd }: UseSessionRevivalParams) {
  const { t } = useI18n();
  const view = useRef({ id: refs.activeSessionIdRef.current, epoch: 0, mounted: true });
  if (view.current.id !== refs.activeSessionIdRef.current) {
    view.current = { ...view.current, id: refs.activeSessionIdRef.current, epoch: view.current.epoch + 1 };
  }
  useEffect(() => {
    view.current.mounted = true;
    return () => { view.current.mounted = false; view.current.epoch++; };
  }, []);

  const revive = useCallback(async (engineId: EngineId, text: string, images?: ImageAttachment[], displayText?: string, alreadyAdded = false, queuedMessageId?: string) => {
    const oldId = refs.activeSessionIdRef.current;
    if (!oldId || oldId === DRAFT_ID) return;
    const session = refs.sessionsRef.current.find((s) => s.id === oldId);
    const project = session && findProject(session.projectId);
    if (!session || !project || (session.engine ?? "claude") !== engineId) return;
    const previousUser = queuedMessageId
      ? refs.messagesRef.current.find((m) => m.id === queuedMessageId && m.isQueued)
      : alreadyAdded ? [...refs.messagesRef.current].reverse().find((m) => m.role === "user" && m.content === text && !m.isQueued) : undefined;
    if (queuedMessageId && !previousUser) return;
    const release = beginSessionRecovery(oldId);
    if (!release) return;

    const engine = engines[engineId];
    const epoch = view.current.epoch;
    const options = { ...refs.startOptionsRef.current };
    const effort = refs.codexEffortRef.current;
    const cwd = getProjectCwd(project);
    const cost = refs.totalCostRef.current;
    const usage = refs.contextUsageRef.current;
    let targetId = oldId;
    let startedId: string | undefined;
    let dispatched = false;
    const ownsView = () => view.current.mounted && view.current.epoch === epoch && refs.activeSessionIdRef.current === targetId;
    const available = () => !isSessionFrozen(oldId) && !isSessionFrozen(targetId)
      && refs.sessionsRef.current.some((s) => s.id === targetId && s.projectId === session.projectId);
    const check = () => { if (!ownsView() || !available()) throw new Error(t("sessionRecoveryCancelled")); };

    // Keep an unsent prompt in the existing queue, including its images. A
    // cancelled restore never adds it to persisted history or activity counts.
    const user = { ...(previousUser ?? createUserMessage(text, images, displayText)), isQueued: true };
    const queuedMessages = (messages: UIMessage[]) => messages.some((m) => m.id === user.id)
      ? messages.map((m) => m.id === user.id ? user : m) : [...messages, user];
    const snapshot = queuedMessages(refs.messagesRef.current);
    refs.messagesRef.current = snapshot;
    engine.setMessages(queuedMessages);
    const queue = refs.messageQueueRef.current.get(oldId) ?? [];
    if (!queue.some((entry) => entry.messageId === user.id)) queue.push({ messageId: user.id, text, images, displayText });
    refs.messageQueueRef.current.set(oldId, queue);
    setters.setQueuedCount(queue.length);
    refs.isProcessingRef.current = true;
    engine.setIsProcessing(true);

    const stopStarted = async () => {
      if (!startedId || isSessionRetired(startedId)) return;
      // A failed recovery cannot drain retained prompts, even when stopping
      // its process fails. The main process keeps that runtime for cleanup.
      refs.liveSessionIdsRef.current.delete(startedId);
      if (engineId === "codex") await window.claude.codex.stop(startedId);
      else {
        const result = engineId === "acp" ? await window.claude.acp.stop(startedId) : await window.claude.stop(startedId, "revival_cancelled");
        if ("error" in result && result.error) throw new Error(String(result.error));
      }
      if (startedId !== targetId) refs.backgroundStoreRef.current.delete(startedId);
    };

    try {
      let next: ChatSession = session;
      let meta: InitialMeta = { isProcessing: true, isConnected: true, sessionInfo: null, totalCost: cost, contextUsage: usage };
      let configOptions: Parameters<typeof setters.setInitialConfigOptions>[0] = [];
      let mcpStatuses: Parameters<typeof setters.setAcpMcpStatuses>[0] = [];
      if (engineId === "acp") {
        if (!session.agentId) throw new Error(t("sessionRecoveryNoAgent"));
        const mcpServers = await window.claude.mcp.list(session.projectId);
        check();
        const result = await window.claude.acp.reviveSession({ agentId: session.agentId, cwd, agentSessionId: session.agentSessionId, mcpServers,
          memoryContext: { projectId: session.projectId }, source: { projectId: session.projectId, runtimeSessionId: oldId } });
        if (result.sessionId) startedId = result.sessionId;
        if (result.error || !startedId) throw new Error(result.error || t("sessionRecoveryFailed"));
        check();
        next = { ...session, id: startedId, conversationId: session.conversationId ?? oldId, agentSessionId: result.agentSessionId ?? session.agentSessionId };
        configOptions = result.configOptions ?? [];
        mcpStatuses = (result.mcpStatuses ?? []).map((s) => ({ name: s.name, status: toMcpStatusState(s.status) }));
      } else if (engineId === "codex") {
        let threadId = session.codexThreadId;
        if (!threadId) {
          const persisted = await window.claude.sessions.load(session.projectId, oldId);
          check(); threadId = persisted?.codexThreadId;
        }
        if (!threadId) throw new Error(t("sessionRecoveryNoThread"));
        buildCodexCollabMode(options.planMode, session.model);
        const result = await window.claude.codex.resume({ cwd, threadId, model: session.model,
          approvalPolicy: getCodexApprovalPolicy(options), sandbox: getCodexSandboxMode(options),
          memoryContext: { projectId: session.projectId }, source: { projectId: session.projectId, runtimeSessionId: oldId } });
        if (result.sessionId) startedId = result.sessionId;
        if (result.error || !startedId) throw new Error(result.error || t("sessionRecoveryFailed"));
        check();
        const goal = result.goalSupported === true ? result.goal ?? null : result.goalSupported === false ? null : result.goal ?? session.codexGoal ?? null;
        next = { ...session, id: startedId, conversationId: session.conversationId ?? oldId, codexThreadId: result.threadId ?? threadId, codexGoal: goal };
        meta = { ...meta, codexGoal: goal, codexGoalSupported: result.goalSupported ?? null };
      } else {
        const result = await window.claude.start({ cwd, model: session.model, permissionMode: getEffectiveClaudePermissionMode(options),
          thinkingEnabled: options.thinkingEnabled, effort: options.effort, resume: oldId,
          memoryContext: { projectId: session.projectId }, source: { projectId: session.projectId, runtimeSessionId: oldId } });
        // A failed duplicate start can refer to somebody else's running query.
        if (result.error) throw new Error(result.error);
        startedId = result.sessionId; check();
        next = { ...session, id: startedId, conversationId: session.conversationId ?? oldId };
      }

      await persistSessionReplacement(oldId, buildPersistedSession(next, snapshot.filter((m) => !m.isQueued), cost, usage));
      const maySend = ownsView() && available();
      // Reflect a committed disk rename even if navigation happened during the
      // write. Only the source pane may follow that rename; others keep focus.
      targetId = next.id;
      const remap = (sessions: ChatSession[]) => sessions.map((s) => s.id === oldId && s.projectId === session.projectId
        ? { ...s, id: next.id, conversationId: next.conversationId, agentSessionId: next.agentSessionId, codexThreadId: next.codexThreadId, codexGoal: next.codexGoal } : s);
      refs.sessionsRef.current = remap(refs.sessionsRef.current);
      if (view.current.mounted) setters.setSessions(remap);
      const background = refs.backgroundStoreRef.current.get(oldId);
      const currentMessages = refs.activeSessionIdRef.current === oldId ? refs.messagesRef.current : background?.messages ?? snapshot;
      if (targetId !== oldId) {
        if (background) { refs.backgroundStoreRef.current.delete(oldId); refs.backgroundStoreRef.current.initFromState(targetId, background); }
        const remainingQueue = refs.messageQueueRef.current.get(oldId);
        if (remainingQueue) { refs.messageQueueRef.current.set(targetId, remainingQueue); refs.messageQueueRef.current.delete(oldId); }
        refs.liveSessionIdsRef.current.delete(oldId);
      }
      if (refs.activeSessionIdRef.current === oldId && view.current.mounted && !isSessionFrozen(targetId)) {
        if (maySend) view.current.id = targetId;
        refs.activeSessionIdRef.current = targetId;
        setters.setInitialMessages(currentMessages);
        setters.setInitialMeta(meta);
        setters.setInitialConfigOptions(configOptions);
        setters.setAcpMcpStatuses(mcpStatuses);
        setters.setActiveSessionId(targetId);
      }
      if (!maySend) throw new Error(t("sessionRecoveryCancelled"));
      check();
      refs.liveSessionIdsRef.current.add(targetId);
      if (engineId === "acp") {
        refs.acpAgentIdRef.current = next.agentId ?? null;
        refs.acpAgentSessionIdRef.current = next.agentSessionId ?? null;
      }

      const deadline = Date.now() + 5_000;
      while (!engine.isReadyForSession(targetId)) {
        check();
        if (Date.now() >= deadline) throw new Error(t("sessionRecoveryViewNotReady"));
        await new Promise((resolve) => setTimeout(resolve, 16));
      }
      check();
      const pending = refs.messageQueueRef.current.get(targetId) ?? [];
      if (!pending.some((q) => q.messageId === user.id)) throw new Error(t("sessionRecoveryCancelled"));
      const rest = pending.filter((q) => q.messageId !== user.id);
      if (rest.length) refs.messageQueueRef.current.set(targetId, rest); else refs.messageQueueRef.current.delete(targetId);
      setters.setQueuedCount(rest.length);
      engine.setMessages((messages) => {
        const rest = messages.filter((m) => m.id !== user.id);
        return [...rest.filter((m) => !m.isQueued), { ...user, isQueued: false, timestamp: Date.now() }, ...rest.filter((m) => m.isQueued)];
      });
      engine.setIsProcessing(true);
      dispatched = true;
      capture("session_revived", { engine: engineId, success: true });
      const sending = engineId === "acp" ? window.claude.acp.prompt(targetId, text, images)
        : engineId === "codex" ? window.claude.codex.send(targetId, text, imageAttachmentsToCodexInputs(images), effort, buildCodexCollabMode(options.planMode, session.model))
          : window.claude.send(targetId, { type: "user", message: { role: "user", content: buildSdkContent(text, images) } });
      // ACP's prompt promise lasts for the whole turn. Once the restored view
      // owns the runtime, ordinary streaming saves and exports must resume.
      release();
      const result = await sending;
      if (result?.error) throw new Error(result.error);
    } catch (error) {
      try { await stopStarted(); }
      catch (stopError) { toast.error(reportError("SESSION_REVIVAL_STOP", stopError)); }
      if (available()) {
        const message = error instanceof Error ? error.message : String(error);
        const system = createSystemMessage(message, true, dispatched && isRetryableUpstreamError(message));
        if (view.current.mounted && refs.activeSessionIdRef.current === targetId) {
          engine.setMessages((messages) => [...messages, system]);
          engine.setIsProcessing(false); refs.isProcessingRef.current = false;
        } else {
          refs.backgroundStoreRef.current.updateMessages(targetId, (messages) => [...messages, system]);
          refs.backgroundStoreRef.current.setProcessing(targetId, false);
          if (view.current.mounted) toast.error(t("sessionRecoveryUnsent"));
        }
      }
    } finally { release(); }
  }, [engines, findProject, getProjectCwd, refs, setters, t]);

  return {
    reviveQueuedMessage: useCallback(async (messageId: string) => {
      const id = refs.activeSessionIdRef.current;
      if (!id || refs.liveSessionIdsRef.current.has(id)) return;
      const session = refs.sessionsRef.current.find((s) => s.id === id);
      const queued = refs.messageQueueRef.current.get(id)?.find((entry) => entry.messageId === messageId);
      if (session && queued) await revive(session.engine ?? "claude", queued.text, queued.images, queued.displayText, false, messageId);
    }, [refs, revive]),
    reviveSession: useCallback((text: string, images?: ImageAttachment[], displayText?: string) => revive("claude", text, images, displayText), [revive]),
    reviveAcpSession: useCallback((text: string, images?: ImageAttachment[], displayText?: string, alreadyAdded?: boolean) => revive("acp", text, images, displayText, alreadyAdded), [revive]),
    reviveCodexSession: useCallback((text: string, images?: ImageAttachment[], displayText?: string, alreadyAdded?: boolean) => revive("codex", text, images, displayText, alreadyAdded), [revive]),
  };
}
