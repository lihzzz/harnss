const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (formatters.size >= 32) formatters.delete(formatters.keys().next().value ?? "");
    formatters.set(timeZone, value);
  }
  return value;
}
export function localHistoryDate(timestamp: number, timeZone: string): string {
  const parts = formatter(timeZone).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year").padStart(4, "0")}-${value("month")}-${value("day")}`;
}
export function historyDateRange(fromDate: string, toDate: string): string[] {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid history date");
    const time = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("Invalid history date");
    return time;
  };
  const from = parse(fromDate), to = parse(toDate);
  const count = (to - from) / 86400000;
  if (count < 1 || count > 366) throw new Error("Choose between 1 and 366 calendar days");
  return Array.from({ length: count }, (_, index) => new Date(from + index * 86400000).toISOString().slice(0, 10));
}

/** Earliest instant belonging to a local date, including midnight DST transitions. */
export function localDayStart(date: string, timeZone: string): number {
  formatter(timeZone); // Reject unknown IANA zones before calculating boundaries.
  const center = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(center) || new Date(center).toISOString().slice(0, 10) !== date) throw new Error("Invalid history date");
  let low = center - 36 * 3600000, high = center + 36 * 3600000;
  while (high - low > 1) {
    const middle = Math.floor((high + low) / 2);
    if (localHistoryDate(middle, timeZone) < date) low = middle; else high = middle;
  }
  return high;
}
