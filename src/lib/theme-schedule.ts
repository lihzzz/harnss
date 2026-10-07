/**
 * Time-based ("auto") theme resolution helpers.
 *
 * Pure functions with no DOM/store dependencies so they can be unit-tested
 * in a node environment and reused by the useTheme hook.
 */

export type AutoResolvedTheme = "light" | "dark";

export const DEFAULT_AUTO_DAY_START = 7;
export const DEFAULT_AUTO_NIGHT_START = 19;

/** Clamp an arbitrary number to a valid hour of day (integer 0-23). */
export function normalizeHour(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  return ((rounded % 24) + 24) % 24;
}

/**
 * Resolve the auto theme for a given local time.
 * The day window is [dayStart, nightStart) in local hours; when
 * nightStart < dayStart the window wraps past midnight.
 * Degenerate config (dayStart === nightStart) resolves to "light".
 */
export function resolveAutoTheme(
  dayStart: number,
  nightStart: number,
  date: Date = new Date(),
): AutoResolvedTheme {
  if (dayStart === nightStart) return "light";
  const hour = date.getHours();
  const isDay = dayStart < nightStart
    ? hour >= dayStart && hour < nightStart
    : hour >= dayStart || hour < nightStart;
  return isDay ? "light" : "dark";
}

/**
 * Milliseconds from `now` until the next day/night boundary
 * (the upcoming local time whose hour is dayStart or nightStart, at minute 0).
 */
export function msUntilNextAutoBoundary(
  now: Date,
  dayStart: number,
  nightStart: number,
): number {
  const candidates: number[] = [];
  for (const dayOffset of [0, 1]) {
    for (const hour of [dayStart, nightStart]) {
      const boundary = new Date(now);
      boundary.setDate(boundary.getDate() + dayOffset);
      boundary.setHours(hour, 0, 0, 0);
      const diff = boundary.getTime() - now.getTime();
      if (diff > 0) candidates.push(diff);
    }
  }
  return Math.min(...candidates);
}
