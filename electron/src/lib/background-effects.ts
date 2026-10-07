import { app, nativeTheme, type BrowserWindow } from "electron";
import os from "os";
import type { BackgroundEffect, BackgroundEffectState } from "@shared/types/background-effect";
import type { MacBackgroundEffect } from "@shared/types/settings";
import { applyGlass, glassEnabled } from "./glass";
import { reportError } from "./error-utils";
import { safeSend } from "./safe-send";

interface BackgroundEnvironment {
  platform: string;
  release: string;
  memoryBytes: number;
  cpuCount: number;
  gpuCompositing: string | undefined;
  reducedTransparency: boolean;
  highContrast: boolean;
  liquidGlassSupported: boolean;
  macEffect: Exclude<MacBackgroundEffect, "off">;
}

function supportsMicaAlt(release: string): boolean {
  const [major, , build] = release.split(".").map(Number);
  return major > 10 || (major === 10 && build >= 22621);
}

/** Conservative startup heuristics, not a GPU benchmark. 8 GiB devices remain eligible. */
export function resolveBackgroundEffect(env: BackgroundEnvironment): Pick<BackgroundEffectState, "availableEffect" | "fallbackReason"> {
  if (env.memoryBytes < 8 * 1024 ** 3) return { availableEffect: null, fallbackReason: "low-memory" };
  if (env.cpuCount <= 2) return { availableEffect: null, fallbackReason: "low-cpu" };
  if (env.highContrast) return { availableEffect: null, fallbackReason: "high-contrast" };
  if (env.reducedTransparency) return { availableEffect: null, fallbackReason: "reduced-transparency" };
  if (!env.gpuCompositing) return { availableEffect: null, fallbackReason: "gpu-pending" };
  if (env.gpuCompositing !== "enabled") return { availableEffect: null, fallbackReason: "gpu-unavailable" };

  if (env.platform === "darwin") {
    return {
      availableEffect: env.liquidGlassSupported ? env.macEffect : "vibrancy",
      fallbackReason: null,
    };
  }
  if (env.platform === "win32") {
    // Electron's DWM background material API requires Windows 11 22H2 (22621).
    if (supportsMicaAlt(env.release)) {
      return { availableEffect: "mica-alt", fallbackReason: null };
    }
  }
  if (env.platform === "linux") {
    // CSS blurs an in-app backdrop; Electron cannot blur the desktop on all compositors.
    return { availableEffect: "gaussian-blur", fallbackReason: null };
  }
  return { availableEffect: null, fallbackReason: "unsupported-platform" };
}

/** Owns native material changes and publishes only the state that was actually applied. */
export function createBackgroundEffects(getWindow: () => BrowserWindow | null) {
  const hardware = { memoryBytes: os.totalmem(), cpuCount: os.cpus().length };
  let gpuReady = false;
  let transparency = false; // Preload restores the renderer preference before enabling a material.
  let macEffect: Exclude<MacBackgroundEffect, "off"> = "liquid-glass";
  let liquidGlassApplied = false;
  let nativeFailed = false;
  let lastEffect: BackgroundEffect | null = null;
  let lastBackgroundColor: string | null = null;
  let state: BackgroundEffectState = {
    effect: "solid", availableEffect: null, fallbackReason: "gpu-pending",
    liquidGlassSupported: glassEnabled, requiresRestart: false,
  };

  function refresh(): BackgroundEffectState {
    const policy = resolveBackgroundEffect({
      ...hardware,
      platform: process.platform,
      release: os.release(),
      gpuCompositing: gpuReady ? app.getGPUFeatureStatus().gpu_compositing : undefined,
      reducedTransparency: nativeTheme.prefersReducedTransparency,
      highContrast: nativeTheme.shouldUseHighContrastColors || nativeTheme.inForcedColorsMode,
      liquidGlassSupported: glassEnabled,
      macEffect,
    });
    const next: BackgroundEffectState = {
      ...policy,
      effect: transparency ? policy.availableEffect ?? "solid" : "solid",
      liquidGlassSupported: glassEnabled,
      requiresRestart: false,
    };
    if (nativeFailed) {
      next.effect = "solid";
      next.availableEffect = null;
      next.fallbackReason = "native-effect-failed";
    }
    // The addon has no removeView API. Keep its live material until a clean restart.
    if (next.effect === "vibrancy" && liquidGlassApplied) {
      next.effect = "liquid-glass";
      next.requiresRestart = true;
    }

    const window = getWindow();
    if (window && !window.isDestroyed()) {
      if (next.effect === "liquid-glass" && !liquidGlassApplied && window.webContents.isLoadingMainFrame()) {
        next.effect = "solid"; // Apply after did-finish-load, before exposing transparent surfaces.
      }
      try {
        if (!nativeFailed && next.effect !== lastEffect) {
          if (process.platform === "win32" && supportsMicaAlt(os.release())) {
            window.setBackgroundMaterial(next.effect === "mica-alt" ? "tabbed" : "none");
          } else if (process.platform === "darwin") {
            window.setVibrancy(next.effect === "vibrancy" ? "under-window" : null);
            if (next.effect === "liquid-glass" && !liquidGlassApplied) {
              if (applyGlass(window.getNativeWindowHandle()) === -1) throw new Error("Liquid Glass addView failed");
              liquidGlassApplied = true;
            }
          }
          lastEffect = next.effect;
        }
        const backgroundColor = next.effect === "solid" || next.effect === "gaussian-blur"
          ? (nativeTheme.shouldUseDarkColors ? "#141414" : "#ffffff")
          : "#00000000";
        if (backgroundColor !== lastBackgroundColor) {
          window.setBackgroundColor(backgroundColor);
          lastBackgroundColor = backgroundColor;
        }
      } catch (error) {
        reportError("BACKGROUND_EFFECT", error);
        nativeFailed = true;
        lastEffect = null;
        // Stop retrying a broken native effect on focus/theme events.
        next.effect = "solid";
        next.availableEffect = null;
        next.fallbackReason = "native-effect-failed";
        next.requiresRestart = false;
        // Best-effort native teardown; opaque renderer surfaces also cover an
        // already-mounted Liquid Glass view, which the addon cannot remove.
        try {
          if (process.platform === "win32" && supportsMicaAlt(os.release())) window.setBackgroundMaterial("none");
          if (process.platform === "darwin") window.setVibrancy(null);
          lastBackgroundColor = nativeTheme.shouldUseDarkColors ? "#141414" : "#ffffff";
          window.setBackgroundColor(lastBackgroundColor);
        } catch (cleanupError) {
          reportError("BACKGROUND_EFFECT_CLEANUP", cleanupError);
        }
      }
    }
    const changed = next.effect !== state.effect
      || next.availableEffect !== state.availableEffect
      || next.fallbackReason !== state.fallbackReason
      || next.requiresRestart !== state.requiresRestart;
    state = next;
    if (changed) safeSend(getWindow, "app:background-effect-changed", state);
    return state;
  }

  app.on("gpu-info-update", () => {
    gpuReady = true;
    if (app.isReady()) refresh();
  });
  nativeTheme.on("updated", () => {
    if (app.isReady()) refresh();
  });

  return {
    refresh,
    getState: () => state,
    setTransparency(enabled: boolean) {
      transparency = enabled;
      return refresh();
    },
    setMacEffect(effect: Exclude<MacBackgroundEffect, "off">) {
      macEffect = effect;
      return refresh();
    },
  };
}
