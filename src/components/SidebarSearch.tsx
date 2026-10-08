import { lazy, Suspense, memo, useRef, useState } from "react";
import { CalendarDays, Search } from "lucide-react";
import type { HistoryLocation } from "@shared/types/productivity";
import type { Project, Space } from "@/types";
import { useI18n } from "@/lib/i18n";

const HistoryPanel = lazy(() => import("./history/HistoryPanel").then((module) => ({ default: module.HistoryPanel })));
interface SidebarSearchProps {
  projects: Project[];
  spaces: Space[];
  activeSpaceId: string;
  activeProjectId: string | null;
  onNavigate: (location: HistoryLocation) => Promise<void>;
}
export const SidebarSearch = memo(function SidebarSearch(props: SidebarSearchProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"search" | "activity">("search");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const changeOpen = (next: boolean) => { setOpen(next); if (!next) requestAnimationFrame(() => triggerRef.current?.focus()); };
  return <div className="no-drag px-3 pb-3 pt-1">
    <div className="flex gap-1 rounded-xl border border-sidebar-border bg-sidebar-accent/40">
      <button type="button" onClick={(event) => { triggerRef.current = event.currentTarget; setView("search"); setOpen(true); }} className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-start text-[13px] text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <Search className="size-4 shrink-0" /><span className="truncate">{t("Search all conversations")}</span>
      </button>
      <button type="button" title={t("Activity")} aria-label={t("Activity")} onClick={(event) => { triggerRef.current = event.currentTarget; setView("activity"); setOpen(true); }} className="rounded-xl px-2 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><CalendarDays className="size-4" /></button>
    </div>
    {open && <Suspense fallback={<p role="status" className="p-2 text-xs">{t("Loading history…")}</p>}><HistoryPanel {...props} open={open} onOpenChange={changeOpen} initialView={view} /></Suspense>}
  </div>;
});
