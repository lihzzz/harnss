/**
 * Colorblind-safe palette mode.
 * Applies the `cb-safe` class on <html>, which overrides the diff semantic
 * tokens (--diff-add-*, --diff-remove-*) and chart colors with a
 * blue/orange Okabe-Ito-inspired palette (see index.css).
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";

export function useColorblindMode(): void {
  const colorblindSafe = useSettingsStore((s) => s.colorblindSafe);

  useEffect(() => {
    document.documentElement.classList.toggle("cb-safe", colorblindSafe);
  }, [colorblindSafe]);
}
