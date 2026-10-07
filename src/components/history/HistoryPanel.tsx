import { useCallback, useMemo, useState } from "react";
import { RefreshCw, Search, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";
import { reportError } from "@/lib/analytics/analytics";
import { useSettingsStore } from "@/stores/settings-store";
import { useHistoryResults } from "@/hooks/useHistoryResults";
import { useHistoryStatus } from "@/hooks/useHistoryStatus";
import { localDayStart, localHistoryDate } from "@shared/lib/history-time";
import type { HistoryHit, HistoryLocation, HistoryScope } from "@shared/types/productivity";
import type { Project, Space } from "@/types";
import { HistoryResults } from "./HistoryResults";
import { HistoryActivity } from "./HistoryActivity";

const selectClass = "rounded-md border bg-background px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-ring";
function nextDate(date: string): string { return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10); }
export interface HistoryPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialView: "search" | "activity";
  projects: Project[];
  spaces: Space[];
  activeSpaceId: string;
  activeProjectId: string | null;
  onNavigate: (location: HistoryLocation) => Promise<void>;
}
export function HistoryPanel(props: HistoryPanelProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent className="flex h-[min(820px,85vh)] min-h-0 flex-col gap-3 sm:max-w-4xl">
      {props.open && <HistoryPanelContent {...props} />}
    </DialogContent>
  </Dialog>;
}
function HistoryPanelContent({ initialView, projects, spaces, activeSpaceId, activeProjectId, onNavigate, onOpenChange }: HistoryPanelProps) {
  const { t } = useI18n();
  const preferences = useSettingsStore((state) => state.historyPreferences);
  const setPreferences = useSettingsStore((state) => state.setHistoryPreferences);
  const [view, setView] = useState(initialView);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [project, setProject] = useState(activeProjectId ?? projects[0]?.id ?? "");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [unknownTime, setUnknownTime] = useState(false);
  const { status, statusError, acceptStatus } = useHistoryStatus();
  const [refreshKey, setRefreshKey] = useState(0);
  const [opening, setOpening] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localHistoryDate(Date.now(), timeZone);
  const yearStart = new Date(Date.parse(`${today}T00:00:00Z`) - 364 * 86400000).toISOString().slice(0, 10);
  const scope: HistoryScope = useMemo(() => preferences.scope === "space" ? { kind: "space", spaceId: activeSpaceId }
    : preferences.scope === "project" ? { kind: "projects", projectIds: project ? [project] : [] } : { kind: "all" }, [preferences.scope, activeSpaceId, project]);
  const engines = useMemo(() => preferences.engine === "all" ? [] : [preferences.engine], [preferences.engine]);
  const dateBounds = useMemo(() => {
    try {
      const from = view === "activity" && selectedDate ? localDayStart(selectedDate, timeZone) : fromDate ? localDayStart(fromDate, timeZone) : null;
      const to = view === "activity" && selectedDate ? localDayStart(nextDate(selectedDate), timeZone) : toDate ? localDayStart(toDate, timeZone) : null;
      return { from, to, error: from !== null && to !== null && from >= to };
    } catch { return { from: null, to: null, error: true }; }
  }, [view, selectedDate, fromDate, toDate, timeZone]);
  const queryTooLong = [...query.trim()].length > 512;
  const semanticReady = status?.semanticState === "ready" || (status?.semanticProgress.indexedEntries ?? 0) > 0 && status?.semanticState !== "disabled";
  const mode = semanticReady ? preferences.mode : "keyword";
  const results = useHistoryResults(dateBounds.error || composing || view === "search" && (!query.trim() || queryTooLong) ? null : view === "search" ? {
    type: "search", request: { query, scope, engines, includeArchived: preferences.includeArchived, from: dateBounds.from, to: dateBounds.to, mode,
      sort: mode === "keyword" ? preferences.sort : "relevance", limit: 30 },
  } : { type: "timeline", request: { scope, engines, includeArchived: preferences.includeArchived,
    from: dateBounds.from, to: dateBounds.to, unknownTime, limit: 50 } }, view === "activity" ? `${refreshKey}:${status?.generation ?? 0}` : refreshKey);
  const openHit = useCallback((hit: HistoryHit) => {
    setOpening(true); setActionError(null);
    void onNavigate(hit).then(() => onOpenChange(false)).catch((error: unknown) => {
      setActionError(reportError("HISTORY:OPEN", error));
    }).finally(() => setOpening(false));
  }, [onNavigate, onOpenChange]);
  const indexAction = async (cancel: boolean) => {
    setActionError(null);
    try {
      const response = await (cancel ? window.claude.history.cancelRebuild() : window.claude.history.rebuild());
      if (!response.ok) setActionError(response.error.message); else acceptStatus(response.value);
    } catch (error) { setActionError(reportError("HISTORY:REBUILD", error)); }
  };
  const coverage = results.coverage ?? status?.coverage;
  const updated = results.generation !== null && status?.state === "idle" && status.generation !== results.generation;
  return <>
    <DialogTitle>{t("Conversation history")}</DialogTitle>
    <DialogDescription className="text-xs">{t("Search your saved conversations or browse agent interactions by date.")}</DialogDescription>
    <div className="flex shrink-0 gap-2" role="group" aria-label={t("History view")}>
      <Button size="sm" variant={view === "search" ? "secondary" : "ghost"} aria-pressed={view === "search"} onClick={() => setView("search")}><Search />{t("Search")}</Button>
      <Button size="sm" variant={view === "activity" ? "secondary" : "ghost"} aria-pressed={view === "activity"} onClick={() => setView("activity")}><CalendarDays />{t("Activity")}</Button>
    </div>
    {view === "search" && <input aria-label={t("Search all conversation history")} placeholder={t("Search all conversation history")} value={query} autoFocus
      className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onChange={(event) => setQuery(event.target.value)} onCompositionStart={() => setComposing(true)} onCompositionEnd={(event) => { setQuery(event.currentTarget.value); setComposing(false); }}
      onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) setRefreshKey((value) => value + 1); }} />}
    <div className="flex shrink-0 flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs">{t("Scope")}<select className={selectClass} value={preferences.scope} onChange={(event) => {
        const value = event.target.value; if (value === "all" || value === "space" || value === "project") setPreferences({ scope: value });
      }}><option value="all">{t("All projects")}</option><option value="space">{t("Current space")}: {spaces.find((space) => space.id === activeSpaceId)?.name}</option><option value="project">{t("Project")}</option></select></label>
      {preferences.scope === "project" && <label className="flex flex-col gap-1 text-xs">{t("Project")}<select className={selectClass} value={project} onChange={(event) => setProject(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <label className="flex flex-col gap-1 text-xs">{t("Engine")}<select className={selectClass} value={preferences.engine} onChange={(event) => {
        const value = event.target.value; if (value === "all" || value === "claude" || value === "codex" || value === "acp") setPreferences({ engine: value });
      }}><option value="all">{t("All engines")}</option><option value="claude">Claude</option><option value="codex">Codex</option><option value="acp">ACP</option></select></label>
      {view === "search" && <>
        <label className="flex flex-col gap-1 text-xs">{t("Search mode")}<select className={selectClass} value={mode} onChange={(event) => {
          const value = event.target.value; if (value === "keyword" || value === "semantic" || value === "hybrid") setPreferences({ mode: value });
        }}><option value="keyword">{t("Keyword")}</option><option value="semantic" disabled={!semanticReady}>{t("Semantic")}</option><option value="hybrid" disabled={!semanticReady}>{t("Hybrid")}</option></select></label>
        <label className="flex flex-col gap-1 text-xs">{t("Sort")}<select className={selectClass} disabled={mode !== "keyword"} value={mode === "keyword" ? preferences.sort : "relevance"} onChange={(event) => {
          const value = event.target.value; if (value === "recent" || value === "relevance") setPreferences({ sort: value });
        }}><option value="recent">{t("Most recent")}</option><option value="relevance">{t("Relevance")}</option></select></label>
      </>}
      <label className="flex flex-col gap-1 text-xs">{t("From date")}<input type="date" className={selectClass} value={fromDate} onChange={(event) => { setFromDate(event.target.value); setSelectedDate(null); }} /></label>
      <label className="flex flex-col gap-1 text-xs">{t("Before date")}<input type="date" className={selectClass} value={toDate} onChange={(event) => { setToDate(event.target.value); setSelectedDate(null); }} /></label>
      <label className="flex items-center gap-1.5 py-1.5 text-xs"><input type="checkbox" checked={preferences.includeArchived} onChange={(event) => setPreferences({ includeArchived: event.target.checked })} />{t("Include archived")}</label>
    </div>
    {view === "activity" && <>
      <HistoryActivity request={{ scope, engines, includeArchived: preferences.includeArchived, fromDate: fromDate || yearStart, toDate: toDate || nextDate(today), timeZone }}
        generation={status?.generation ?? 0} selectedDate={selectedDate} onSelectDate={(date) => { setSelectedDate(date); setUnknownTime(false); }} />
      <div className="flex items-center justify-between text-xs">
        <span>{unknownTime ? t("Unknown time") : selectedDate ?? t("All dates")}</span>
        <div className="flex items-center gap-3"><label className="flex items-center gap-1"><input type="checkbox" checked={unknownTime} onChange={(event) => { setUnknownTime(event.target.checked); setSelectedDate(null); }} />{t("Unknown time")}</label>
          {selectedDate && <button type="button" className="underline" onClick={() => setSelectedDate(null)}>{t("Clear date")}</button>}</div>
      </div>
    </>}
    {(dateBounds.error || queryTooLong) && <p role="alert" className="text-xs text-destructive">{t(queryTooLong ? "Enter between 1 and 512 characters" : "Choose a valid date range")}</p>}
    {(results.error || actionError || statusError) && <p role="alert" className="text-xs text-destructive">{actionError ?? statusError ?? (results.error?.code === "CURSOR_EXPIRED" ? t("History changed. Refresh the results.") : results.error?.message)}</p>}
    {(updated || results.error?.retryable) && <Button size="sm" variant="outline" className="self-start" onClick={() => { setActionError(null); setRefreshKey((value) => value + 1); }}><RefreshCw />{t("Refresh results")}</Button>}
    {results.warnings.length > 0 && <p className="text-xs text-amber-600 dark:text-amber-400" role="status">{t("Some history could not be included. Check index coverage below.")}</p>}
    {view === "search" && preferences.mode !== "keyword" && (status && !semanticReady || results.modeUsed === "keyword") && <p role="status" className="text-xs text-amber-600 dark:text-amber-400">{t("Semantic search is unavailable. Showing keyword matches.")}</p>}
    {results.rankingWindow !== null && <p role="status" className="text-xs text-muted-foreground">{t("Ranked results, up to")}: {results.rankingWindow} · {t("Semantic coverage")}: {coverage?.semanticIndexed ?? 0} / {coverage?.discovered ?? 0}
      {coverage && !coverage.semanticComplete ? ` · ${t("Incomplete")}` : ""}</p>}
    {results.loading && <p role="status" className="text-xs text-muted-foreground">{t("searching")}</p>}
    {!results.loading && !results.error && results.items.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t(view === "search" && !query.trim() ? "Enter text to search saved conversation history." : "noResultsFound")}</p>}
    <HistoryResults items={results.items} onOpen={openHit} disabled={opening} />
    {results.nextCursor && <Button size="sm" variant="outline" disabled={results.loading || results.error?.code === "CURSOR_EXPIRED"} onClick={results.loadMore}>{t("Load more")}</Button>}
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
      <span role="status">{t("History coverage")}: {coverage?.indexed ?? 0} / {coverage?.discovered ?? 0} · {t("Skipped")}: {coverage?.skipped ?? 0} · {t("Failed")}: {coverage?.failed ?? 0}
        {coverage && !coverage.keywordComplete ? ` · ${t("Incomplete")}` : ""}{status?.state === "indexing" || status?.state === "rebuilding" ? ` · ${t("Indexing…")}` : ""}</span>
      <Button size="sm" variant="ghost" disabled={status?.state === "indexing"} onClick={() => { void indexAction(status?.state === "rebuilding"); }}>{t(status?.state === "rebuilding" ? "Cancel rebuild" : "Rebuild search index")}</Button>
    </div>
  </>;
}
