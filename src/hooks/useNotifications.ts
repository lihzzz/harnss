import { useEffect, useEffectEvent, useRef } from "react";
import type { ChatSession, PermissionRequest, NotificationSettings, NotificationTrigger, SessionInfo, CodexThreadGoal } from "@/types";
import {
  advanceSessionCompletionTracker,
  consumeSuppressedSessionCompletion,
  shouldNotifyPermissionRequest,
} from "@/lib/notification-utils";
import { getGoalNotificationTransition } from "@shared/lib/codex-goal";
import { getSessionNotificationActor } from "@/lib/session-notifications";

// ── Defaults (used when AppSettings hasn't loaded yet) ──

const FALLBACK: NotificationSettings = {
  exitPlanMode: { osNotification: "unfocused", sound: "always" },
  permissions: { osNotification: "unfocused", sound: "unfocused" },
  askUserQuestion: { osNotification: "unfocused", sound: "always" },
  sessionComplete: { osNotification: "unfocused", sound: "always" },
};

// ── Lazy-created and cached Audio element ──

let cachedAudio: HTMLAudioElement | null = null;

function getNotificationSoundUrl(): string {
  return new URL("./sounds/notification.wav", window.location.href).toString();
}

function getAudio(): HTMLAudioElement {
  if (!cachedAudio) {
    cachedAudio = new Audio(getNotificationSoundUrl());
    cachedAudio.volume = 0.6;
  }
  return cachedAudio;
}

// ── Helpers ──

/** Check if a trigger condition is met given current window focus state. */
function shouldFire(trigger: NotificationTrigger): boolean {
  if (trigger === "never") return false;
  if (trigger === "always") return true;
  // "unfocused" — fire whenever the renderer window itself is not focused.
  return !document.hasFocus();
}

/** Fire OS notification + sound based on event settings. */
function fireNotification(
  eventSettings: { osNotification: NotificationTrigger; sound: NotificationTrigger },
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (shouldFire(eventSettings.osNotification)) {
    // Web Notification API — Electron auto-grants permission.
    // silent: true prevents OS from playing its own sound (we manage sound separately).
    const notification = new Notification(title, { body, silent: true });
    notification.onclick = () => {
      window.focus();
      onClick?.();
      notification.close();
    };
  }

  if (shouldFire(eventSettings.sound)) {
    const audio = getAudio();
    audio.currentTime = 0; // reset in case a previous play is still going
    audio.play().catch(() => {
      // Autoplay may be blocked in some edge cases — ignore silently
    });
  }
}

/** Map a permission request's toolName to one of the three event types. */
function classifyEvent(
  toolName: string,
): "exitPlanMode" | "askUserQuestion" | "permissions" {
  if (toolName === "ExitPlanMode") return "exitPlanMode";
  if (toolName === "AskUserQuestion") return "askUserQuestion";
  return "permissions";
}

/** Human-readable notification content for each event type. */
function getNotificationContent(
  eventType: "exitPlanMode" | "askUserQuestion" | "permissions",
  request: PermissionRequest,
  actor: string,
): { title: string; body: string } {
  switch (eventType) {
    case "exitPlanMode":
      return {
        title: "Ready to implement",
        body: `${actor} has a plan and is waiting for your approval.`,
      };
    case "askUserQuestion": {
      const questions = request.toolInput?.questions as
        | Array<{ question: string }>
        | undefined;
      return {
        title: `Question from ${actor}`,
        body: questions?.[0]?.question ?? `${actor} is asking you a question.`,
      };
    }
    case "permissions": {
      const filePath = request.toolInput?.file_path as string | undefined;
      const command = request.toolInput?.command as string | undefined;
      const detail = filePath ?? (command ? String(command).slice(0, 80) : "");
      return {
        title: "Permission required",
        body: detail
          ? `Allow ${request.toolName}: ${detail}?`
          : `Allow ${request.toolName}?`,
      };
    }
  }
}

// ── Hook ──

interface UseNotificationsOptions {
  pendingPermission: PermissionRequest | null;
  notificationSettings: NotificationSettings | null;
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  sessionInfo: SessionInfo | null;
  /** Whether the agent is currently processing (used to detect session completion) */
  isProcessing: boolean;
  codexGoal?: CodexThreadGoal | null;
  onOpenSession?: (sessionId: string) => void;
}

interface BackgroundSessionCompleteDetail {
  sessionId: string;
  sessionTitle: string;
  actor: string;
}

interface BackgroundPermissionDetail {
  sessionId: string;
  sessionTitle: string;
  actor: string;
  permission: PermissionRequest;
}

interface BackgroundGoalDetail {
  sessionId: string;
  goal: CodexThreadGoal | null;
}

export function useNotifications({
  pendingPermission,
  notificationSettings,
  activeSessionId,
  activeSession,
  sessionInfo,
  isProcessing,
  codexGoal,
  onOpenSession,
}: UseNotificationsOptions): void {
  const settings = notificationSettings ?? FALLBACK;
  const activeActor = getSessionNotificationActor(activeSession, sessionInfo);
  const openSession = useEffectEvent((sessionId: string) => {
    onOpenSession?.(sessionId);
  });
  const previousGoal = useRef<{ sessionId: string | null; goal: CodexThreadGoal | null }>({
    sessionId: activeSessionId,
    goal: codexGoal ?? null,
  });
  const goalNotificationKeys = useRef(new Set<string>());
  const backgroundGoals = useRef(new Map<string, CodexThreadGoal | null>());

  useEffect(() => {
    if (previousGoal.current.sessionId !== activeSessionId) {
      previousGoal.current = { sessionId: activeSessionId, goal: codexGoal ?? null };
      return;
    }
    const transition = getGoalNotificationTransition(previousGoal.current.goal, codexGoal ?? null);
    previousGoal.current = { sessionId: activeSessionId, goal: codexGoal ?? null };
    const notificationKey = transition.key && activeSessionId ? `${activeSessionId}:${transition.key}` : null;
    if (!codexGoal || !notificationKey || transition.kind === "none" || goalNotificationKeys.current.has(notificationKey)) return;
    if (transition.kind === "completed" || transition.kind === "blocked" || transition.kind === "limited") {
      goalNotificationKeys.current.add(notificationKey);
      const title = transition.kind === "completed" ? "Goal complete" : transition.kind === "blocked" ? "Goal blocked" : "Goal limit reached";
      fireNotification(settings.sessionComplete, title, `${activeActor}: ${codexGoal.objective}`, activeSessionId ? () => openSession(activeSessionId) : undefined);
    }
  }, [activeActor, activeSessionId, codexGoal, openSession, settings]);

  // ── Permission-based notifications ──

  // Track every request we've already surfaced so foreground/background
  // re-presentation of the same open permission doesn't replay the sound.
  const seenPermissionKeys = useRef(new Set<string>());

  useEffect(() => {
    if (!pendingPermission) return;

    if (!shouldNotifyPermissionRequest(seenPermissionKeys.current, {
      sessionId: activeSessionId,
      requestId: pendingPermission.requestId,
    })) {
      return;
    }

    const eventType = classifyEvent(pendingPermission.toolName);
    const eventSettings = settings[eventType];
    const { title, body } = getNotificationContent(eventType, pendingPermission, activeActor);
    fireNotification(
      eventSettings,
      title,
      body,
      activeSessionId ? () => openSession(activeSessionId) : undefined,
    );
  }, [activeActor, activeSessionId, openSession, pendingPermission, settings]);

  // ── Session completion notification ──

  // Track the active session alongside processing so chat switches do not look
  // like a completed turn for the newly selected session.
  const prevSessionState = useRef({ sessionId: activeSessionId, isProcessing });

  useEffect(() => {
    const current = { sessionId: activeSessionId, isProcessing };
    const { completed, tracked } = advanceSessionCompletionTracker(
      prevSessionState.current,
      current,
    );
    prevSessionState.current = tracked;

    if (completed && !codexGoal) {
      if (consumeSuppressedSessionCompletion(current.sessionId)) return;
      fireNotification(
        settings.sessionComplete,
        "Task complete",
        `${activeActor} has finished processing.`,
        current.sessionId ? () => openSession(current.sessionId as string) : undefined,
      );
    }
  }, [activeActor, activeSessionId, codexGoal, isProcessing, openSession, settings]);

  // ── Background session notifications ──
  useEffect(() => {
    const onBackgroundComplete = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundSessionCompleteDetail>).detail;
      if (!detail) return;
      if (consumeSuppressedSessionCompletion(detail.sessionId)) return;
      const title = detail.sessionTitle || "Background session";
      fireNotification(
        settings.sessionComplete,
        "Task complete",
        `${title}: ${detail.actor} has finished processing.`,
        () => openSession(detail.sessionId),
      );
    };

    const onBackgroundPermission = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundPermissionDetail>).detail;
      if (!detail?.permission) return;
      if (!shouldNotifyPermissionRequest(seenPermissionKeys.current, {
        sessionId: detail.sessionId,
        requestId: detail.permission.requestId,
      })) {
        return;
      }
      const eventType = classifyEvent(detail.permission.toolName);
      const eventSettings = settings[eventType];
      const { title, body } = getNotificationContent(eventType, detail.permission, detail.actor);
      const sessionPrefix = detail.sessionTitle
        ? `${detail.sessionTitle}: `
        : "";
      fireNotification(
        eventSettings,
        title,
        `${sessionPrefix}${body}`,
        () => openSession(detail.sessionId),
      );
    };

    const onBackgroundGoal = (evt: Event) => {
      const detail = (evt as CustomEvent<BackgroundGoalDetail>).detail;
      if (!detail?.sessionId) return;
      const transition = getGoalNotificationTransition(
        backgroundGoals.current.get(detail.sessionId) ?? null,
        detail.goal ?? null,
      );
      backgroundGoals.current.set(detail.sessionId, detail.goal ?? null);
      const notificationKey = transition.key && detail?.sessionId ? `${detail.sessionId}:${transition.key}` : null;
      if (!detail?.goal || !notificationKey || goalNotificationKeys.current.has(notificationKey)) return;
      if (transition.kind !== "completed" && transition.kind !== "blocked" && transition.kind !== "limited") return;
      goalNotificationKeys.current.add(notificationKey);
      const title = transition.kind === "completed" ? "Goal complete" : transition.kind === "blocked" ? "Goal blocked" : "Goal limit reached";
      fireNotification(settings.sessionComplete, title, `${detail.goal.objective}`, () => openSession(detail.sessionId));
    };

    window.addEventListener("harnss:background-session-complete", onBackgroundComplete as EventListener);
    window.addEventListener("harnss:background-permission-request", onBackgroundPermission as EventListener);
    window.addEventListener("harnss:background-goal-updated", onBackgroundGoal as EventListener);
    return () => {
      window.removeEventListener("harnss:background-session-complete", onBackgroundComplete as EventListener);
      window.removeEventListener("harnss:background-permission-request", onBackgroundPermission as EventListener);
      window.removeEventListener("harnss:background-goal-updated", onBackgroundGoal as EventListener);
    };
  }, [openSession, settings]);
}
