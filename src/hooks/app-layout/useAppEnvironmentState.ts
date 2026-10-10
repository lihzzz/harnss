import { useCallback, useEffect, useState } from "react";
import { useGlassOrchestrator } from "@/hooks/useGlassOrchestrator";
import { useNotifications } from "@/hooks/useNotifications";
import type { ChatSession, MacBackgroundEffect, NotificationSettings, PermissionRequest, SessionInfo, ThemeOption, CodexThreadGoal } from "@/types";
import type { SettingsSection } from "@/components/SettingsView";

interface UseAppEnvironmentStateInput {
  macBackgroundEffect: MacBackgroundEffect;
  setMacBackgroundEffect: (value: MacBackgroundEffect) => void;
  transparency: boolean;
  theme: ThemeOption;
  pendingPermission: PermissionRequest | null;
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  sessionInfo: SessionInfo | null;
  isProcessing: boolean;
  codexGoal?: CodexThreadGoal | null;
  onOpenSession?: (sessionId: string) => void;
}

type MainView = { kind: "workspace" } | { kind: "apps" } | { kind: "settings"; section: SettingsSection };

export function useAppEnvironmentState(input: UseAppEnvironmentStateInput) {
  const [mainView, setMainView] = useState<MainView>({ kind: "workspace" });
  const showSettings: SettingsSection | false = mainView.kind === "settings" ? mainView.section : false;
  const showApps = mainView.kind === "apps";
  const setShowSettings = useCallback((section: SettingsSection | false) => {
    setMainView((current) => section ? { kind: "settings", section } : current.kind === "settings" ? { kind: "workspace" } : current);
  }, []);
  const setShowApps = useCallback((visible: boolean) => {
    setMainView((current) => visible ? { kind: "apps" } : current.kind === "apps" ? { kind: "workspace" } : current);
  }, []);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | undefined>();
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings | null>(null);
  const [devFillEnabled, setDevFillEnabled] = useState(false);

  const { glassSupported, glassActive, macLiquidGlassSupported, liveMacBackgroundEffect } = useGlassOrchestrator({
    macBackgroundEffect: input.macBackgroundEffect,
    setMacBackgroundEffect: input.setMacBackgroundEffect,
    transparency: input.transparency,
    theme: input.theme,
  });

  useEffect(() => {
    window.claude.settings.get().then((settings) => {
      if (settings?.notifications) {
        setNotificationSettings(settings.notifications as NotificationSettings);
      }
      setDevFillEnabled(import.meta.env.DEV && !!settings?.showDevFillInChatTitleBar);
    });
  }, [showSettings]);

  useNotifications({
    pendingPermission: input.pendingPermission,
    notificationSettings,
    activeSessionId: input.activeSessionId,
    activeSession: input.activeSession,
    sessionInfo: input.sessionInfo,
    isProcessing: input.isProcessing,
    codexGoal: input.codexGoal,
    onOpenSession: input.onOpenSession,
  });

  useEffect(() => {
    window.dispatchEvent(new Event("resize"));
  }, [mainView.kind]);

  useEffect(() => {
    setChatSearchOpen(false);
  }, [input.activeSessionId]);

  return {
    mainView,
    showApps,
    setShowApps,
    showSettings: mainView.kind === "settings" ? mainView.section : false as const,
    setShowSettings,
    scrollToMessageId,
    setScrollToMessageId,
    chatSearchOpen,
    setChatSearchOpen,
    glassSupported,
    glassActive,
    macLiquidGlassSupported,
    liveMacBackgroundEffect,
    devFillEnabled,
  };
}
