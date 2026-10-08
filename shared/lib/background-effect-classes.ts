import type { BackgroundEffectState } from "../types/background-effect";

/** Shared by preload and React so first paint and subsequent policy changes agree. */
export function applyBackgroundEffectClasses(
  classList: { toggle: (token: string, force: boolean) => unknown },
  state: BackgroundEffectState,
): void {
  classList.toggle("glass-enabled", state.effect !== "solid");
  classList.toggle("gaussian-blur-enabled", state.effect === "gaussian-blur");
  classList.toggle("transparency-reduced", state.fallbackReason !== null && state.fallbackReason !== "gpu-pending");
}
