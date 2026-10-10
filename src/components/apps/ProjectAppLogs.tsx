import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { reportError } from "@/lib/analytics/analytics";
import type { AppLogEntry, AppLogPage } from "@shared/types/project-apps";
import { appInputClass } from "./AppFields";
import { mergeAppLogs, nextAppLogRecoveryCursor, unwrapAppResult } from "./app-utils";

export function ProjectAppLogs({ runId }: { runId: string }) {
  const { t, language } = useI18n();
  const [entries, setEntries] = useState<AppLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [reload, setReload] = useState(0);
  const [copied, setCopied] = useState(false);
  const [unavailableBeforeSeq, setUnavailableBeforeSeq] = useState(0);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const recoveryAttempts = useRef(new Map<number, number>());
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: AppLogPage[] = [];
    setEntries([]); setTruncated(false); setError(null); setUnavailableBeforeSeq(0); recoveryAttempts.current.clear();
    const flush = () => {
      timer = null;
      const pages = pending; pending = [];
      if (cancelled || !pages.length) return;
      setEntries((previous) => pages.reduce((current, page) => mergeAppLogs(current, page), previous));
      if (pages.some((page) => page.truncated)) setTruncated(true);
      pages.filter((page) => page.truncated).forEach((page) => setUnavailableBeforeSeq((floor) => Math.max(floor, page.entries[0]?.seq ?? page.nextSeq)));
    };
    const accept = (page: AppLogPage) => {
      if (page.runId !== runId || cancelled) return;
      pending.push(page);
      if (!timer) timer = setTimeout(flush, 100);
    };
    const unsubscribe = window.claude.projectApps.onEvent((event) => { if (event.kind === "logs") accept(event.page); });
    const load = async () => {
      let cursor = 0;
      for (let index = 0; index < 10 && !cancelled; index += 1) {
        const page = unwrapAppResult(await window.claude.projectApps.logs({ runId, afterSeq: cursor, limit: 1000 }));
        accept(page);
        if (page.nextSeq <= cursor || page.entries.length < 1000) break;
        cursor = page.nextSeq;
      }
    };
    void load().catch((cause) => { if (!cancelled) setError(reportError("project-apps:logs", cause)); });
    return () => { cancelled = true; unsubscribe(); if (timer) clearTimeout(timer); pending = []; };
  }, [runId, reload]);
  const recoveryCursor = nextAppLogRecoveryCursor(entries, unavailableBeforeSeq, recoveryAttempts.current);
  useEffect(() => {
    if (recoveryCursor === null) return;
    const cursor = recoveryCursor;
    let cancelled = false;
    const timer = setTimeout(() => {
      recoveryAttempts.current.set(cursor, (recoveryAttempts.current.get(cursor) ?? 0) + 1);
      if (recoveryAttempts.current.size > 32) { const oldest = recoveryAttempts.current.keys().next().value; if (oldest !== undefined) recoveryAttempts.current.delete(oldest); }
      void window.claude.projectApps.logs({ runId, afterSeq: cursor, limit: 2000 }).then(unwrapAppResult).then((page) => {
        if (cancelled) return;
        if (page.truncated) { setTruncated(true); setUnavailableBeforeSeq((floor) => Math.max(floor, page.entries[0]?.seq ?? page.nextSeq)); }
        setEntries((previous) => mergeAppLogs(previous, page));
      }).catch((cause) => { if (!cancelled) setError(reportError("project-apps:replay-logs", cause)); })
        .finally(() => { if (!cancelled) setRecoveryRevision((value) => value + 1); });
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recoveryCursor, runId, recoveryRevision]);
  const filtered = useMemo(() => filter.trim() ? entries.filter((entry) => entry.text.toLowerCase().includes(filter.toLowerCase())) : entries, [entries, filter]);
  const hasSequenceGap = useMemo(() => entries.some((entry, index) => index > 0 && entry.seq > entries[index - 1].seq + 1), [entries]);
  const virtualizer = useVirtualizer({ count: filtered.length, getScrollElement: () => viewport.current, estimateSize: () => 24, overscan: 8, getItemKey: (index) => filtered[index].seq });
  useEffect(() => { if (follow && filtered.length) virtualizer.scrollToIndex(filtered.length - 1, { align: "end" }); }, [filtered.length, follow, virtualizer]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(false), 1800); return () => clearTimeout(timer); }, [copied]);
  return <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2"><input aria-label={t("appsLogFilter")} placeholder={t("appsLogFilter")} className={`${appInputClass} min-w-32 flex-1`} value={filter} onChange={(e) => setFilter(e.target.value)} /><label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />{t("appsFollow")}</label><Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)} aria-label={t("appsRefresh")}><RefreshCw className="size-3.5" /></Button><Button size="sm" variant="outline" onClick={() => { void window.claude.writeClipboardText(filtered.map((entry) => entry.text).join("\n")).then((result) => { if (result.error) throw new Error(result.error); setCopied(true); }).catch((cause) => setError(reportError("project-apps:copy-logs", cause))); }}><Copy className="size-3.5" />{t(copied ? "appsCopied" : "appsCopy")}</Button></div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    {(truncated || entries.length >= 3000) && <p className="text-xs text-muted-foreground">{t("appsTruncated")}</p>}
    {hasSequenceGap && <p className="text-xs text-amber-600">{t("appsSequenceGap")}</p>}
    <div ref={viewport} className="min-h-40 flex-1 overflow-auto rounded-md border bg-muted/25" onWheel={(event) => { if (event.deltaY < 0) setFollow(false); }}>
      {!filtered.length ? <p className="p-4 text-sm text-muted-foreground">{t("appsLogsEmpty")}</p> : <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((row) => { const entry = filtered[row.index]; return <div key={row.key} data-index={row.index} ref={virtualizer.measureElement} className="absolute start-0 top-0 flex w-full gap-3 px-3 py-0.5 font-mono text-xs" style={{ transform: `translateY(${row.start}px)` }}><time className="shrink-0 text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString(language, { hour12: false })}</time><pre className={`min-w-0 whitespace-pre-wrap wrap-break-word ${entry.stream === "stderr" ? "text-red-600 dark:text-red-400" : entry.stream === "system" ? "text-muted-foreground" : ""}`}>{entry.text}</pre></div>; })}
      </div>}
    </div>
  </div>;
}
