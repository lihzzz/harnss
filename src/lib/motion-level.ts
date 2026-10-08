/** Motion level resolution. Pure and node-testable; the hook lives in useMotionLevel.ts. */

import type { MotionLevelOption } from "@shared/types/settings";

export type ResolvedMotionLevel = "full" | "reduced";

export function resolveMotionLevel(setting: MotionLevelOption, osPrefersReduced: boolean): ResolvedMotionLevel {
  if (setting === "auto") return osPrefersReduced ? "reduced" : "full";
  return setting;
}
