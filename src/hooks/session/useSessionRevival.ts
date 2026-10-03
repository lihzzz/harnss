import { useCallback } from "react";
import type { ImageAttachment, Project } from "../../types";
import type { CollaborationMode } from "../../types/codex-protocol/CollaborationMode";
import { toMcpStatusState } from "../../lib/mcp-utils";
import { imageAttachmentsToCodexInputs } from "../../lib/engine/codex-adapter";
import { buildSdkContent } from "../../lib/engine/protocol";
import { capture } from "../../lib/analytics/analytics";
import { createSystemMessage, createUserMessage } from "../../lib/message-factory";
import { isRetryableUpstreamError } from "../../lib/session/retry";
import {
  DRAFT_ID,
  getEffectiveClaudePermissionMode,
  getCodexApprovalPolicy,
  getCodexSandboxMode,
  buildCodexCollabMode,
} from "./types";
import type { SharedSessionRefs, SharedSessionSetters, EngineHooks } from "./types";

interface UseSessionRevivalParams {
  refs: SharedSessionRefs;
  setters: SharedSessionSetters;
  engines: EngineHooks;
  findProject: (projectId: string) => Project | null;
  getProjectCwd: (project: Project) => string;
}

export function useSessionRevival({
  refs,
  setters,
  engines,
  findProject,
  getProjectCwd,
}: UseSessionRevivalParams) {
  const { acp, codex, engine } = engines;
  const {
    setSessions,
    setActiveSessionId,
    setInitialMessages,
    setInitialMeta,
    setInitialConfigOptions,
    setAcpMcpStatuses,
  } = setters;
  const {
    activeSessionIdRef,
    sessionsRef,
    messagesRef,
    totalCostRef,
    contextUsageRef,
    liveSessionIdsRef,
    startOptionsRef,
    codexEffortRef,
    acpAgentIdRef,
    acpAgentSessionIdRef,
  } = refs;

  const reviveAcpSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, userMessageAlreadyAdded = false) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session || !session.agentId) {
        acp.setMessages((prev) => [...prev, createSystemMessage("ACP session disconnected. Please start a new session.", true)]);
        return;
      }
      const project = findProject(session.projectId);
      if (!project) return;

      const mcpServers = await window.claude.mcp.list(session.projectId);
      const result = await window.claude.acp.reviveSession({
        agentId: session.agentId,
        cwd: getProjectCwd(project),
        agentSessionId: session.agentSessionId,
        mcpServers,
      });

      if (result.error || !result.sessionId) {
        const errorText = result.error || "Failed to reconnect ACP session. Please start a new session.";
        acp.setMessages((prev) => [...prev, createSystemMessage(errorText, true, isRetryableUpstreamError(errorText))]);
        return;
      }

      const newId = result.sessionId;
      liveSessionIdsRef.current.add(newId);
      acpAgentIdRef.current = session.agentId;
      acpAgentSessionIdRef.current = result.agentSessionId ?? session.agentSessionId ?? null;

      setSessions((prev) => prev.map((s) =>
        s.id === oldId
          ? { ...s, id: newId, conversationId: s.conversationId ?? oldId, agentSessionId: result.agentSessionId ?? s.agentSessionId }
          : s,
      ));
      setAcpMcpStatuses((result.mcpStatuses ?? []).map(s => ({
        name: s.name,
        status: toMcpStatusState(s.status),
      })));
      setInitialMessages(messagesRef.current);
      setInitialMeta({
        isProcessing: false,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
      });
      if (result.configOptions?.length) setInitialConfigOptions(result.configOptions);
      setActiveSessionId(newId);

      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!userMessageAlreadyAdded) {
        acp.setMessages((prev) => [...prev, createUserMessage(text, images, displayText)]);
      }
      acp.setIsProcessing(true);
      capture("message_sent", {
        engine: "acp",
        session_id: newId,
        has_images: !!images?.length,
        message_length: text.length,
      });
      const promptResult = await window.claude.acp.prompt(newId, text, images);
      if (promptResult?.error) {
        acp.setMessages((prev) => [...prev, createSystemMessage(`ACP error: ${promptResult.error}`, true, isRetryableUpstreamError(promptResult.error ?? ""))]);
        acp.setIsProcessing(false);
      }
    },
    [findProject, acp.setMessages, acp.setIsProcessing],
  );

  /** Revive a dead Codex session — spawn new app-server + thread/resume */
  const reviveCodexSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string, userMessageAlreadyAdded = false) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      // Resolve thread ID from in-memory session first, then persisted session.
      let codexThreadId: string | undefined = session.codexThreadId;
      if (!codexThreadId) {
        try {
          const persisted = await window.claude.sessions.load(session.projectId, oldId);
          codexThreadId = persisted?.codexThreadId;
        } catch { /* ignore */ }
      }

      if (!codexThreadId) {
        codex.setMessages((prev) => [...prev, createSystemMessage("Codex session cannot be resumed (no thread ID). Please start a new session.", true)]);
        return;
      }

      const result = await window.claude.codex.resume({
        cwd: getProjectCwd(project),
        threadId: codexThreadId,
        model: session.model,
        approvalPolicy: getCodexApprovalPolicy(startOptionsRef.current),
        sandbox: getCodexSandboxMode(startOptionsRef.current),
      });

      if (result.error || !result.sessionId) {
        const errorText = result.error || "Failed to resume Codex session.";
        codex.setMessages((prev) => [...prev, createSystemMessage(errorText, true, isRetryableUpstreamError(errorText))]);
        return;
      }

      const newId = result.sessionId;
      liveSessionIdsRef.current.add(newId);

      // A supported app-server returning `goal: null` is authoritative. Only
      // fall back to the local snapshot when the response predates Goal support.
      const resumedGoal = result.goalSupported === true
        ? result.goal ?? null
        : result.goalSupported === false
          ? null
          : result.goal ?? session.codexGoal ?? null;

      setSessions((prev) => prev.map((s) =>
        s.id === oldId ? { ...s, id: newId, conversationId: s.conversationId ?? oldId, codexThreadId: result.threadId ?? codexThreadId, codexGoal: resumedGoal } : s,
      ));
      setInitialMessages(messagesRef.current);
      setInitialMeta({
        isProcessing: false,
        isConnected: true,
        sessionInfo: null,
        totalCost: totalCostRef.current,
        contextUsage: contextUsageRef.current,
        codexGoal: resumedGoal,
        codexGoalSupported: result.goalSupported ?? null,
      });
      setActiveSessionId(newId);

      // Small delay to let hook pick up new sessionId
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (!userMessageAlreadyAdded) {
        codex.setMessages((prev) => [...prev, createUserMessage(text, images, displayText)]);
      }
      codex.setIsProcessing(true);
      let codexCollabMode: CollaborationMode | undefined;
      try {
        codexCollabMode = buildCodexCollabMode(startOptionsRef.current.planMode, session.model);
      } catch (err) {
        codex.setMessages((prev) => [...prev, createSystemMessage(err instanceof Error ? err.message : String(err), true)]);
        codex.setIsProcessing(false);
        return;
      }
      const sendResult = await window.claude.codex.send(
        newId,
        text,
        imageAttachmentsToCodexInputs(images),
        codexEffortRef.current,
        codexCollabMode,
      );
      if (sendResult?.error) {
        codex.setMessages((prev) => [...prev, createSystemMessage(`Unable to send message: ${sendResult.error}`, true, isRetryableUpstreamError(sendResult.error ?? ""))]);
        codex.setIsProcessing(false);
      }
    },
    [findProject, codex.setMessages, codex.setIsProcessing],
  );

  // Claude SDK revival — resume session to restore conversation context
  const reviveSession = useCallback(
    async (text: string, images?: ImageAttachment[], displayText?: string) => {
      const oldId = activeSessionIdRef.current;
      if (!oldId || oldId === DRAFT_ID) return;
      const session = sessionsRef.current.find((s) => s.id === oldId);
      if (!session) return;
      const project = findProject(session.projectId);
      if (!project) return;

      const startPayload = {
        cwd: getProjectCwd(project),
        ...(session.model ? { model: session.model } : {}),
        permissionMode: getEffectiveClaudePermissionMode(startOptionsRef.current),
        thinkingEnabled: startOptionsRef.current.thinkingEnabled,
        effort: startOptionsRef.current.effort,
        resume: oldId, // Resume the SDK session to restore conversation context
      };

      let result;
      try {
        result = await window.claude.start(startPayload);
      } catch (err) {
        engine.setMessages((prev) => [
          ...prev,
          createSystemMessage(
            `Failed to resume session: ${err instanceof Error ? err.message : String(err)}`,
            true,
            isRetryableUpstreamError(err instanceof Error ? err.message : String(err)),
          ),
        ]);
        return;
      }
      if (result.error) {
        engine.setMessages((prev) => [
          ...prev,
          createSystemMessage(result.error!, true, isRetryableUpstreamError(result.error!)),
        ]);
        return;
      }
      const newSessionId = result.sessionId;
      capture("session_revived", { engine: "claude", success: true });

      if (newSessionId !== oldId) {
        // SDK returned a different ID (shouldn't happen with resume, but handle it)
        liveSessionIdsRef.current.delete(oldId);
        liveSessionIdsRef.current.add(newSessionId);

        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId
              ? { ...s, id: newSessionId, isActive: true }
              : { ...s, isActive: false },
          ),
        );

        const oldData = await window.claude.sessions.load(project.id, oldId);
        if (oldData) {
          await window.claude.sessions.save({
            ...oldData,
            id: newSessionId,
            conversationId: session.conversationId ?? oldData.conversationId ?? oldId,
            messages: messagesRef.current,
            model: session.model ?? oldData.model,
          });
          await window.claude.sessions.delete(project.id, oldId);
        }

        setActiveSessionId(newSessionId);
      } else {
        liveSessionIdsRef.current.add(oldId);
        setSessions((prev) =>
          prev.map((s) =>
            s.id === oldId ? { ...s, isActive: true } : { ...s, isActive: false },
          ),
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 50));

      const content = buildSdkContent(text, images);
      const sendResult = await window.claude.send(newSessionId, {
        type: "user",
        message: { role: "user", content },
      });
      if (sendResult?.error) {
        liveSessionIdsRef.current.delete(newSessionId);
        engine.setMessages((prev) => [
          ...prev,
          createSystemMessage(
            `Unable to send message: ${sendResult.error}`,
            true,
            isRetryableUpstreamError(sendResult.error ?? ""),
          ),
        ]);
        return;
      }
      engine.setMessages((prev) => [
        ...prev,
        createUserMessage(text, images, displayText),
      ]);
    },
    [engine.setMessages, findProject],
  );

  return {
    reviveSession,
    reviveAcpSession,
    reviveCodexSession,
  };
}
