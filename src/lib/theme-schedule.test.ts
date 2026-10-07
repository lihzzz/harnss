import { describe, expect, it } from "vitest";
import {
  msUntilNextAutoBoundary,
  normalizeHour,
  resolveAutoTheme,
} from "@/lib/theme-schedule";

function at(hour: number, minute = 0): Date {
  const d = new Date(2026, 5, 15);
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("resolveAutoTheme", () => {
  it("returns light during the day window", () => {
    expect(resolveAutoTheme(7, 19, at(10))).toBe("light");
  });

  it("returns dark outside the day window", () => {
    expect(resolveAutoTheme(7, 19, at(22))).toBe("dark");
    expect(resolveAutoTheme(7, 19, at(3))).toBe("dark");
  });

  it("treats dayStart as inclusive and nightStart as night", () => {
    expect(resolveAutoTheme(7, 19, at(7))).toBe("light");
    expect(resolveAutoTheme(7, 19, at(19))).toBe("dark");
  });

  it("supports day windows wrapping past midnight", () => {
    expect(resolveAutoTheme(19, 7, at(22))).toBe("light");
    expect(resolveAutoTheme(19, 7, at(3))).toBe("light");
    expect(resolveAutoTheme(19, 7, at(10))).toBe("dark");
  });

  it("resolves degenerate config to light", () => {
    expect(resolveAutoTheme(12, 12, at(0))).toBe("light");
    expect(resolveAutoTheme(12, 12, at(15))).toBe("light");
  });
});

describe("normalizeHour", () => {
  it("clamps to 0-23", () => {
    expect(normalizeHour(0, 7)).toBe(0);
    expect(normalizeHour(23, 7)).toBe(23);
    expect(normalizeHour(24, 7)).toBe(0);
    expect(normalizeHour(25, 7)).toBe(1);
    expect(normalizeHour(-1, 7)).toBe(23);
  });

  it("rounds fractional hours and falls back on NaN", () => {
    expect(normalizeHour(7.6, 7)).toBe(8);
    expect(normalizeHour(Number.NaN, 7)).toBe(7);
  });
});

describe("msUntilNextAutoBoundary", () => {
  const HOUR_MS = 3_600_000;

  it("targets the next same-day boundary", () => {
    expect(msUntilNextAutoBoundary(at(10, 30), 7, 19)).toBe(8.5 * HOUR_MS);
  });

  it("wraps to the next day after the last boundary", () => {
    expect(msUntilNextAutoBoundary(at(20), 7, 19)).toBe(11 * HOUR_MS);
  });

  it("skips the current instant when exactly on a boundary", () => {
    expect(msUntilNextAutoBoundary(at(19), 7, 19)).toBe(12 * HOUR_MS);
  });
});
