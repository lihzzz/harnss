import { memo, useMemo } from "react";
import { Archive } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { SessionItem } from "@/components/sidebar/SessionItem";
import type { ChatSession, InstalledAgent } from "@/types";
import { useI18n } from "@/lib/i18n";

interface ArchivedSettingsProps {
  sessions: ChatSession[];
  activeSessionId: string | null;
  agents?: InstalledAgent[];
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onArchiveSession: (id: string, archived: boolean) => void;
  onRenameSession: (id: string, title: string) => void;
  onOpenInSplitView?: (id: string) => void;
  canOpenInSplitView?: (id: string) => boolean;
  islandLayout: boolean;
}

export const ArchivedSettings = memo(function ArchivedSettings({
  sessions,
  activeSessionId,
  agents,
  onSelectSession,
  onDeleteSession,
  onArchiveSession,
  onRenameSession,
  onOpenInSplitView,
  canOpenInSplitView,
  islandLayout,
}: ArchivedSettingsProps) {
  const { t } = useI18n();
  const archivedSessions = useMemo(
    () => sessions
      .filter((session) => session.archived)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [sessions],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("archived")}
        description={t("settingsArchivedDescription")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Archive} label={t("archived")} first>
            {archivedSessions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("settingsArchivedEmpty")}
              </div>
            ) : (
              <div className="space-y-1">
                {archivedSessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    islandLayout={islandLayout}
                    surface="settings"
                    session={session}
                    isActive={session.id === activeSessionId}
                    onSelect={() => onSelectSession(session.id)}
                    onDelete={() => onDeleteSession(session.id)}
                    onArchiveToggle={() => onArchiveSession(session.id, false)}
                    onRename={(title) => onRenameSession(session.id, title)}
                    agents={agents}
                    onOpenInSplitView={onOpenInSplitView ? () => onOpenInSplitView(session.id) : undefined}
                    canOpenInSplitView={canOpenInSplitView?.(session.id) ?? true}
                  />
                ))}
              </div>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
