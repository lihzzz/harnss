import { describe, expect, it } from "vitest";
import { applyBackgroundEffectClasses } from "@shared/lib/background-effect-classes";
import type { BackgroundEffectState } from "@shared/types/background-effect";

describe("background effect classes", () => {
  it("clears stale glass and blur classes on automatic fallback and restores them on recovery", () => {
    const tokens = new Set<string>();
    const classes = { toggle: (token: string, enabled: boolean) => enabled ? tokens.add(token) : tokens.delete(token) };
    const state: BackgroundEffectState = {
      effect: "gaussian-blur", availableEffect: "gaussian-blur", fallbackReason: null,
      liquidGlassSupported: false, requiresRestart: false,
    };
    applyBackgroundEffectClasses(classes, state);
    expect([...tokens]).toEqual(["glass-enabled", "gaussian-blur-enabled"]);
    applyBackgroundEffectClasses(classes, { ...state, effect: "solid", availableEffect: null, fallbackReason: "low-memory" });
    expect([...tokens]).toEqual(["transparency-reduced"]);
    applyBackgroundEffectClasses(classes, state);
    expect([...tokens]).toEqual(["glass-enabled", "gaussian-blur-enabled"]);
    applyBackgroundEffectClasses(classes, { ...state, effect: "solid" });
    expect(tokens.size).toBe(0);
  });
});
