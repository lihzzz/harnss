import { memo, useCallback, useMemo, useState } from "react";
import { Archive, ChevronRight, FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { SessionItem } from "@/components/sidebar/SessionItem";
import { SessionSelection } from "@/components/sidebar/SessionSelection";
import { resolveLucideIcon } from "@/lib/icon-utils";
import type { ChatSession, InstalledAgent, Project } from "@/types";
import { useI18n } from "@/lib/i18n";

interface ArchivedSettingsProps {
  sessions: ChatSession[];
  projects: Project[];
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
  projects,
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

  const projectById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );

  const groupedByProject = useMemo(() => {
    const groups = new Map<string, { project?: Project; sessions: ChatSession[] }>();
    for (const session of archivedSessions) {
      const existing = groups.get(session.projectId);
      if (existing) {
        existing.sessions.push(session);
      } else {
        groups.set(session.projectId, {
          project: projectById.get(session.projectId),
          sessions: [session],
        });
      }
    }
    return [...groups.values()].sort(
      (a, b) =>
        (b.sessions[0].lastMessageAt ?? b.sessions[0].createdAt) -
        (a.sessions[0].lastMessageAt ?? a.sessions[0].createdAt),
    );
  }, [archivedSessions, projectById]);

  const [collapsedProjects, setCollapsedProjects] = useState<ReadonlySet<string>>(() => new Set());

  const toggleProjectCollapsed = useCallback((projectKey: string) => {
    setCollapsedProjects((previous) => {
      const next = new Set(previous);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("archived")}
        description={t("settingsArchivedDescription")}
      />

      <SessionSelection sessions={archivedSessions} scopeLabel={t("archived")}>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          <SettingsSection icon={Archive} label={t("archived")} first>
            {archivedSessions.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {t("settingsArchivedEmpty")}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedByProject.map((group) => {
                  const projectKey = group.project?.id ?? group.sessions[0].projectId;
                  const collapsed = collapsedProjects.has(projectKey);
                  return (
                    <div key={projectKey}>
                      <button
                        type="button"
                        onClick={() => toggleProjectCollapsed(projectKey)}
                        aria-expanded={!collapsed}
                        className="mb-1 flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1 text-start transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? "" : "rotate-90"}`}
                        />
                        <ProjectGlyph project={group.project} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-muted-foreground">
                          {group.project?.name ?? t("unknownProject")}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground/60">
                          {group.sessions.length}
                        </span>
                      </button>
                      {!collapsed && (
                        <div className="space-y-1">
                          {group.sessions.map((session) => (
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
                    </div>
                  );
                })}
              </div>
            )}
          </SettingsSection>
        </div>
      </ScrollArea>
      </SessionSelection>
    </div>
  );
});

function ProjectGlyph({ project }: { project?: Project }) {
  if (project?.icon && project.iconType === "emoji") {
    return <span className="h-3.5 w-3.5 shrink-0 text-center text-xs leading-3.5">{project.icon}</span>;
  }
  if (project?.icon && project.iconType === "lucide") {
    const Icon = resolveLucideIcon(project.icon);
    if (Icon) return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  }
  return <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}
