/**
 * Information density mode.
 *
 * `useDensity` applies the density class on <html> (mount once, like useTheme).
 * `useDensityFactor` exposes the numeric scale factor for code that estimates
 * layout sizes in JS (e.g. chat row height estimation).
 */

import { useEffect } from "react";
import type { DensityOption } from "@/types";
import { useSettingsStore } from "@/stores/settings-store";

export const DENSITY_FACTORS: Record<DensityOption, number> = {
  compact: 0.85,
  comfortable: 1,
  loose: 1.15,
};

const DENSITY_CLASSES = ["density-compact", "density-loose"] as const;

export function useDensity(): void {
  const density = useSettingsStore((s) => s.density);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove(...DENSITY_CLASSES);
    if (density === "compact") root.classList.add("density-compact");
    else if (density === "loose") root.classList.add("density-loose");
  }, [density]);
}

export function useDensityFactor(): number {
  const density = useSettingsStore((s) => s.density);
  return DENSITY_FACTORS[density];
}
