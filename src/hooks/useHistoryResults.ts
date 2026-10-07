import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryHit, HistorySearchRequest, HistoryTimelineRequest, HistoryCoverage, OperationError, HistoryTimelineItem, HistoryMode } from "@shared/types/productivity";
import { reportError } from "@/lib/analytics/analytics";

type Query = { type: "search"; request: Omit<HistorySearchRequest, "requestId" | "cursor"> } | { type: "timeline"; request: Omit<HistoryTimelineRequest, "requestId" | "cursor"> };
interface HistoryResults {
  items: Array<HistoryHit | HistoryTimelineItem>;
  nextCursor: string | null;
  generation: number | null;
  coverage: HistoryCoverage | null;
  warnings: OperationError[];
  error: OperationError | null;
  loading: boolean;
  modeUsed: HistoryMode | null;
  rankingWindow: number | null;
}
const emptyResults = (): HistoryResults => ({ items: [], nextCursor: null, generation: null, coverage: null, warnings: [], error: null, loading: false, modeUsed: null, rankingWindow: null });

/** Own request identity across debounce, pagination, IME and late IPC responses. */
export function useHistoryResults(query: Query | null, refreshKey: number | string) {
  const [results, setResults] = useState<HistoryResults>(emptyResults);
  const generationRef = useRef(0);
  const requestRef = useRef<string | null>(null);
  const resultsRef = useRef(results); resultsRef.current = results;
  const queryRef = useRef(query); queryRef.current = query;
  const key = JSON.stringify(query);
  const cancel = useCallback(() => {
    const requestId = requestRef.current;
    requestRef.current = null;
    if (requestId) void window.claude.history.cancel(requestId).catch((error: unknown) => reportError("HISTORY:CANCEL", error));
  }, []);
  const load = useCallback(async function loadPage(cursor: string | null, version: number, retries = 1): Promise<void> {
    const current = queryRef.current;
    if (!current) return;
    const fingerprint = JSON.stringify(current);
    cancel();
    const requestId = crypto.randomUUID();
    requestRef.current = requestId;
    setResults((previous) => ({ ...previous, loading: true, error: null }));
    try {
      const response = current.type === "search"
        ? await window.claude.history.search({ ...current.request, requestId, cursor })
        : await window.claude.history.timeline({ ...current.request, requestId, cursor });
      if (version !== generationRef.current || requestRef.current !== requestId || fingerprint !== JSON.stringify(queryRef.current)) return;
      if (!response.ok) {
        // A save may finish while the first page is loading. Retry that page once
        // against the new generation; existing paginated results still require refresh.
        if (!cursor && retries && response.error.code === "CURSOR_EXPIRED") {
          await new Promise<void>((resolve) => setTimeout(resolve, 250));
          if (version === generationRef.current && requestRef.current === requestId && fingerprint === JSON.stringify(queryRef.current)) await loadPage(null, version, retries - 1);
          return;
        }
        if (response.error.code !== "CANCELLED") setResults((previous) => ({ ...previous, loading: false, error: response.error }));
        return;
      }
      if (response.value.requestId !== requestId) return;
      const value = response.value;
      const items = "hits" in value ? value.hits : value.items;
      setResults((previous) => {
        if (cursor && previous.generation !== value.generation) return { ...previous, loading: false, error: { code: "CURSOR_EXPIRED", message: "History changed. Refresh the results.", retryable: true } };
        return { items: cursor ? [...previous.items, ...items] : items, nextCursor: value.nextCursor, generation: value.generation,
          coverage: value.coverage, warnings: value.warnings, error: null, loading: false,
          modeUsed: "modeUsed" in value ? value.modeUsed : null, rankingWindow: "rankingWindow" in value ? value.rankingWindow : null };
      });
    } catch (error) {
      if (version !== generationRef.current || requestRef.current !== requestId || fingerprint !== JSON.stringify(queryRef.current)) return;
      const message = reportError("HISTORY:QUERY", error);
      setResults((previous) => ({ ...previous, loading: false, error: { code: "IO_ERROR", message, retryable: true } }));
    } finally { if (requestRef.current === requestId) requestRef.current = null; }
  }, [cancel]);
  useEffect(() => {
    const version = ++generationRef.current;
    cancel(); setResults(emptyResults());
    if (!queryRef.current) return;
    const timer = setTimeout(() => { void load(null, version); }, queryRef.current.type === "search" ? 300 : 0);
    return () => { clearTimeout(timer); generationRef.current++; cancel(); };
  }, [key, refreshKey, load, cancel]);
  const loadMore = useCallback(() => {
    const current = resultsRef.current;
    if (!current.loading && current.nextCursor) void load(current.nextCursor, generationRef.current);
  }, [load]);
  return { ...results, loadMore };
}
