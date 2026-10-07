export type BackgroundEffect = "liquid-glass" | "vibrancy" | "mica-alt" | "gaussian-blur" | "solid";

export type BackgroundEffectFallback =
  | "low-memory"
  | "low-cpu"
  | "gpu-pending"
  | "gpu-unavailable"
  | "reduced-transparency"
  | "high-contrast"
  | "unsupported-platform"
  | "native-effect-failed";

/** Effective state, separate from the user's saved transparency preference. */
export interface BackgroundEffectState {
  effect: BackgroundEffect;
  availableEffect: Exclude<BackgroundEffect, "solid"> | null;
  fallbackReason: BackgroundEffectFallback | null;
  liquidGlassSupported: boolean;
  requiresRestart: boolean;
}
