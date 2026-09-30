import { useMemo, useState } from "react";
import { Archive, ChevronRight } from "lucide-react";
import type { ChatSession, InstalledAgent } from "@/types";
import { SessionItem } from "./SessionItem";
import { useSidebarActions } from "./SidebarActionsContext";

export function ArchivedSection({
  sessions,
  activeSessionId,
  islandLayout,
  agents,
}: {
  sessions: ChatSession[];
  activeSessionId: string | null;
  islandLayout: boolean;
  agents?: InstalledAgent[];
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    selectSession,
    deleteSession,
    archiveSession,
    renameSession,
    openInSplitView,
    canOpenSessionInSplitView,
  } = useSidebarActions();

  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)),
    [sessions],
  );

  if (sortedSessions.length === 0) return null;

  return (
    <section className="mt-3 border-t border-sidebar-foreground/[0.08] pt-2">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-start text-[12px] font-semibold text-sidebar-foreground/55 transition-colors hover:bg-black/5 hover:text-sidebar-foreground/80 dark:hover:bg-white/5"
        aria-expanded={expanded}
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        <Archive className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/45" />
        <span className="min-w-0 flex-1 truncate">Archived</span>
        <span className="text-[11px] font-normal text-sidebar-foreground/35">{sortedSessions.length}</span>
      </button>

      {expanded && (
        <div className="mt-0.5 ms-2">
          {sortedSessions.map((session) => (
            <SessionItem
              key={session.id}
              islandLayout={islandLayout}
              session={session}
              isActive={session.id === activeSessionId}
              onSelect={() => selectSession(session.id)}
              onDelete={() => deleteSession(session.id)}
              onArchiveToggle={() => archiveSession(session.id, false)}
              onRename={(title) => renameSession(session.id, title)}
              agents={agents}
              onOpenInSplitView={openInSplitView ? () => openInSplitView(session.id) : undefined}
              canOpenInSplitView={canOpenSessionInSplitView?.(session.id) ?? true}
            />
          ))}
        </div>
      )}
    </section>
  );
}
