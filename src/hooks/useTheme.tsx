import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemePreference } from "@/types";
import { msUntilNextAutoBoundary, resolveAutoTheme } from "@/lib/theme-schedule";
import { useSettingsStore } from "@/stores/settings-store";

export type ResolvedTheme = "light" | "dark";

// ── Theme context ──────────────────────────────────────────────────────

const ThemeContext = createContext<ResolvedTheme>("dark");

/** Wraps the subtree with the resolved theme value from `useTheme`. */
export function ThemeProvider({ value, children }: { value: ResolvedTheme; children: ReactNode }) {
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

/**
 * Reads the current resolved theme ("light" | "dark") from context.
 * Must be rendered inside a `<ThemeProvider>`.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useContext(ThemeContext);
}

function resolveTheme(option: ThemePreference, dayStart: number, nightStart: number): ResolvedTheme {
  if (option === "auto") {
    return resolveAutoTheme(dayStart, nightStart);
  }
  if (option === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return option;
}

/**
 * Resolves a ThemePreference ("light" | "dark" | "system" | "auto") to an
 * effective theme, applies the `dark` CSS class on <html>, listens for OS
 * preference changes in "system" mode, and re-resolves at day/night
 * boundaries in "auto" mode.
 */
export function useTheme(theme: ThemePreference): ResolvedTheme {
  const dayStart = useSettingsStore((s) => s.themeAutoDayStart);
  const nightStart = useSettingsStore((s) => s.themeAutoNightStart);
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(theme, dayStart, nightStart));

  // Re-resolve when the setting or auto schedule changes
  useEffect(() => {
    setResolved(resolveTheme(theme, dayStart, nightStart));
  }, [theme, dayStart, nightStart]);

  // Listen for OS preference changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolved(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  // Re-resolve at the next day/night boundary when in "auto" mode
  useEffect(() => {
    if (theme !== "auto") return;
    let timer = 0;
    const scheduleNext = () => {
      timer = window.setTimeout(() => {
        setResolved(resolveAutoTheme(dayStart, nightStart));
        scheduleNext();
      }, msUntilNextAutoBoundary(new Date(), dayStart, nightStart));
    };
    scheduleNext();
    return () => window.clearTimeout(timer);
  }, [theme, dayStart, nightStart]);

  // Apply the dark class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolved]);

  // Sync theme to main process so native glass appearance matches the app theme.
  // Send the raw option ("light"/"dark"/"system"), not the resolved value,
  // so nativeTheme.themeSource = "system" lets macOS drive glass appearance natively.
  // "auto" has no native equivalent — send the resolved value instead.
  useEffect(() => {
    window.claude.glass?.setTheme(theme === "auto" ? resolved : theme);
  }, [theme, resolved]);

  return resolved;
}
