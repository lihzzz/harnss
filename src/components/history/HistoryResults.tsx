import { Fragment, memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Archive, MessageSquare } from "lucide-react";
import type { HistoryHit, HistoryTimelineItem } from "@shared/types/productivity";
import { useI18n } from "@/lib/i18n";

function Snippet({ hit }: { hit: HistoryHit }) {
  const parts: React.ReactNode[] = [];
  let start = 0;
  for (const range of hit.matchRanges) {
    parts.push(<Fragment key={range.start}>{hit.snippet.slice(start, range.start)}<mark className="rounded-sm bg-primary/20 text-inherit">{hit.snippet.slice(range.start, range.end)}</mark></Fragment>);
    start = range.end;
  }
  return <>{parts}{hit.snippet.slice(start)}</>;
}
const HistoryRow = memo(function HistoryRow({ hit, onOpen, disabled }: { hit: HistoryHit | HistoryTimelineItem; onOpen: (hit: HistoryHit) => void; disabled: boolean }) {
  const { t, language } = useI18n();
  return <button type="button" disabled={disabled} onClick={() => onOpen(hit)} className="w-full rounded-lg border border-transparent p-3 text-start hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
    <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
      <MessageSquare className="size-3 shrink-0" /><span className="min-w-0 truncate">{hit.spaceName ? `${hit.spaceName} / ` : ""}{hit.projectName} · {hit.sessionTitle}</span>
      {hit.archived && <Archive className="size-3 shrink-0" aria-label={t("Archived")} />}
    </div>
    <p className="line-clamp-3 whitespace-pre-wrap wrap-break-word text-sm"><Snippet hit={hit} /></p>
    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
      <span>{hit.engine}</span><span>{hit.timestamp === null ? t("Unknown time") : new Date(hit.timestamp).toLocaleString(language)}</span>
      {"interaction" in hit && <span>{t(`historyKind_${hit.interaction}`)}</span>}
      {hit.matchSources.length > 0 && <span>{hit.matchSources.map((source) => t(`historyMatch_${source}`)).join(" · ")}</span>}
    </div>
  </button>;
});

export function HistoryResults({ items, onOpen, disabled }: { items: Array<HistoryHit | HistoryTimelineItem>; onOpen: (hit: HistoryHit) => void; disabled: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: items.length, getScrollElement: () => scrollRef.current,
    estimateSize: () => 120, overscan: 5, getItemKey: (index) => items[index].hitId });
  return <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" role="list">
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((row) => <div role="listitem" data-index={row.index} ref={virtualizer.measureElement} key={row.key}
        className="absolute inset-x-0 top-0" style={{ transform: `translateY(${row.start}px)` }}>
        <HistoryRow hit={items[row.index]} onOpen={onOpen} disabled={disabled} />
      </div>)}
    </div>
  </div>;
}
