import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryActivityRequest, HistoryActivityResponse } from "@shared/types/productivity";
import { useI18n } from "@/lib/i18n";
import { reportError } from "@/lib/analytics/analytics";

export function HistoryActivity({ request, generation, selectedDate, onSelectDate }: {
  request: Omit<HistoryActivityRequest, "requestId">; generation: number; selectedDate: string | null; onSelectDate: (date: string) => void;
}) {
  const { t, language } = useI18n();
  const [value, setValue] = useState<HistoryActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const inputRef = useRef(request); inputRef.current = request;
  const key = JSON.stringify(request);
  useEffect(() => {
    const requestId = crypto.randomUUID();
    let active = true;
    setLoading(true); setError(null); setValue(null);
    window.claude.history.activity({ ...inputRef.current, requestId }).then((response) => {
      if (!active) return;
      if (!response.ok) { setError(response.error.message); return; }
      setValue(response.value);
    }).catch((reason: unknown) => { if (active) setError(reportError("HISTORY:ACTIVITY", reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; void window.claude.history.cancel(requestId).catch((reason: unknown) => reportError("HISTORY:CANCEL", reason)); };
  }, [key, generation]);
  const maximum = useMemo(() => Math.max(1, ...value?.days.map((day) => day.count) ?? []), [value]);
  const calendar = useMemo(() => {
    const days = value?.days ?? [];
    const offset = days.length ? (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7 : 0;
    const selected = days.findIndex((day) => day.date === (focusedDate ?? selectedDate));
    const focusIndex = selected < 0 ? days.length - 1 : selected;
    const months = days.flatMap((day, index) => index === 0 || day.date.endsWith("-01") ? [{
      key: day.date, column: Math.floor((index + offset) / 7) + 1,
      label: new Date(`${day.date}T12:00:00Z`).toLocaleDateString(language, { timeZone: "UTC", month: "short" }),
    }] : []);
    return { offset, focusIndex, months, columns: Math.ceil((days.length + offset) / 7) };
  }, [value, focusedDate, selectedDate, language]);
  useEffect(() => { buttons.current.get(calendar.focusIndex)?.scrollIntoView({ block: "nearest", inline: "nearest" }); }, [calendar.focusIndex]);
  return <div className="shrink-0 rounded-lg border p-3">
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
      <span>{t("Sent questions per day")} · {request.timeZone}</span>
      {loading && <span role="status">{t("Loading activity…")}</span>}
      {value && !value.coverage.keywordComplete && <span className="text-amber-600 dark:text-amber-400">{t("History coverage is incomplete")}</span>}
    </div>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <div className="overflow-x-auto pb-1">
      <div className="mb-1 grid w-max gap-1 text-[10px] text-muted-foreground" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${calendar.columns}, 0.75rem)` }}>
        {calendar.months.map((month) => <span key={month.key} className="whitespace-nowrap" style={{ gridColumn: month.column }}>{month.label}</span>)}
      </div>
      <div className="grid w-max grid-flow-col grid-rows-7 gap-1" aria-label={t("Activity calendar")}>
        {Array.from({ length: calendar.offset }, (_, index) => <span key={`padding-${index}`} className="size-3" aria-hidden="true" />)}
        {value?.days.map((day, index) => {
          const label = `${new Date(`${day.date}T12:00:00Z`).toLocaleDateString(language, { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" })}: ${day.count} ${t("sent questions")}`;
          const strength = day.count ? 0.2 + 0.8 * day.count / maximum : 0;
          return <button key={day.date} ref={(button) => { if (button) buttons.current.set(index, button); else buttons.current.delete(index); }}
            type="button" title={label} aria-label={label} aria-pressed={selectedDate === day.date} onClick={() => onSelectDate(day.date)}
            tabIndex={index === calendar.focusIndex ? 0 : -1} onFocus={() => setFocusedDate(day.date)}
            className={`size-3 rounded-xs border border-border outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring ${selectedDate === day.date ? "ring-2 ring-ring" : ""}`}
            style={{ background: day.count ? `color-mix(in srgb, var(--primary) ${strength * 100}%, var(--muted))` : "var(--muted)" }}
            onKeyDown={(event) => {
              const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key];
              if (step !== undefined) { event.preventDefault(); buttons.current.get(Math.min(value.days.length - 1, Math.max(0, index + step)))?.focus(); }
              if (event.key === "Home" || event.key === "End") { event.preventDefault(); buttons.current.get(event.key === "Home" ? 0 : value.days.length - 1)?.focus(); }
            }} />;
        })}
      </div>
    </div>
    {value && value.unknownUserCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{t("Questions without a known date")}: {value.unknownUserCount}</p>}
  </div>;
}
