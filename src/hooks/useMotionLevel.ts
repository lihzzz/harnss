/**
 * Effective motion level for entrance/transition animations.
 * "auto" follows the OS prefers-reduced-motion setting via motion/react.
 */

import { useReducedMotion } from "motion/react";
import { resolveMotionLevel, type ResolvedMotionLevel } from "@/lib/motion-level";
import { useSettingsStore } from "@/stores/settings-store";

export function useMotionLevel(): ResolvedMotionLevel {
  const motionLevel = useSettingsStore((s) => s.motionLevel);
  const osReduced = useReducedMotion();
  return resolveMotionLevel(motionLevel, osReduced ?? false);
}
