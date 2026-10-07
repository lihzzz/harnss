/**
 * Applies the active theme preset to <html>.
 *
 * - "default": no theme class, tokens come from index.css :root/.dark.
 * - builtin preset: adds `theme-{id}` class (styles live in themes/presets.css).
 * - custom preset: injects a generated <style> tag and adds `theme-custom`.
 *
 * Precedence note: useSpaceTheme writes the same tokens via inline style,
 * which always wins over theme classes (space tint > preset > default).
 */

import { useEffect } from "react";
import {
  BUILTIN_PRESETS,
  DEFAULT_THEME_ID,
  buildCustomThemeCss,
} from "@/themes/theme-preset";
import { useSettingsStore } from "@/stores/settings-store";

const CUSTOM_THEME_STYLE_ID = "harnss-custom-theme";
const BUILTIN_THEME_CLASSES = BUILTIN_PRESETS.map((p) => `theme-${p.id}`);
const ALL_THEME_CLASSES = [...BUILTIN_THEME_CLASSES, "theme-custom"];

export function useThemePreset(): void {
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const customThemes = useSettingsStore((s) => s.customThemes);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...ALL_THEME_CLASSES);

    const styleEl = document.getElementById(CUSTOM_THEME_STYLE_ID) as HTMLStyleElement | null;
    const removeStyle = () => styleEl?.remove();

    if (activeThemeId === DEFAULT_THEME_ID) {
      removeStyle();
      return;
    }

    const custom = customThemes.find((t) => t.id === activeThemeId);
    if (custom) {
      const el = styleEl ?? document.createElement("style");
      el.id = CUSTOM_THEME_STYLE_ID;
      el.textContent = buildCustomThemeCss(custom);
      if (!styleEl) document.head.appendChild(el);
      root.classList.add("theme-custom");
      return;
    }

    removeStyle();
    if (BUILTIN_THEME_CLASSES.includes(`theme-${activeThemeId}`)) {
      root.classList.add(`theme-${activeThemeId}`);
    }
  }, [activeThemeId, customThemes]);
}
