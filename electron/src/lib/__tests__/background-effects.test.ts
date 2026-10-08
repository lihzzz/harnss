import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, BrowserWindow, nativeTheme } from "electron";
import { createBackgroundEffects, resolveBackgroundEffect } from "../background-effects";
import { applyGlass } from "../glass";

const machine = vi.hoisted(() => ({
  memoryBytes: 16 * 1024 ** 3,
  cpuCount: 8,
  release: "10.0.22621",
  gpuCompositing: "enabled",
  reducedTransparency: false,
  highContrast: false,
  dark: true,
}));

vi.mock("os", () => ({ default: {
  totalmem: () => machine.memoryBytes,
  cpus: () => Array.from({ length: machine.cpuCount }),
  release: () => machine.release,
} }));
vi.mock("../glass", () => ({ glassEnabled: true, applyGlass: vi.fn(() => 1) }));
vi.mock("../error-utils", () => ({ reportError: vi.fn() }));
vi.mock("electron", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    app: Object.assign(new EventEmitter(), {
      isReady: () => true,
      getGPUFeatureStatus: () => ({ gpu_compositing: machine.gpuCompositing }),
    }),
    nativeTheme: Object.defineProperties(new EventEmitter(), {
      prefersReducedTransparency: { get: () => machine.reducedTransparency },
      shouldUseHighContrastColors: { get: () => machine.highContrast },
      inForcedColorsMode: { value: false },
      shouldUseDarkColors: { get: () => machine.dark },
    }),
    BrowserWindow: class {
      isDestroyed = vi.fn(() => false);
      setBackgroundMaterial = vi.fn();
      setBackgroundColor = vi.fn();
      setVibrancy = vi.fn();
      getNativeWindowHandle = vi.fn(() => Buffer.alloc(8));
      webContents = { isLoadingMainFrame: vi.fn(() => false), send: vi.fn() };
    },
  };
});

const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
function platform(value: string) {
  Object.defineProperty(process, "platform", { configurable: true, value });
}

beforeEach(() => {
  vi.clearAllMocks();
  app.removeAllListeners();
  nativeTheme.removeAllListeners();
  Object.assign(machine, {
    memoryBytes: 16 * 1024 ** 3, cpuCount: 8, release: "10.0.22621",
    gpuCompositing: "enabled", reducedTransparency: false, highContrast: false, dark: true,
  });
  platform("win32");
});
afterEach(() => Object.defineProperty(process, "platform", originalPlatform));

const environment = {
  platform: "win32", release: "10.0.22621", memoryBytes: 8 * 1024 ** 3, cpuCount: 4,
  gpuCompositing: "enabled", reducedTransparency: false, highContrast: false,
  liquidGlassSupported: true, macEffect: "liquid-glass" as const,
};

describe("background policy", () => {
  it.each([
    ["darwin", "25.0.0", "liquid-glass"],
    ["win32", "10.0.22621", "mica-alt"],
    ["win32", "10.0.26100", "mica-alt"],
    ["linux", "6.8.0", "gaussian-blur"],
  ])("selects the available material on %s %s", (platform, release, availableEffect) => {
    expect(resolveBackgroundEffect({ ...environment, platform, release }))
      .toEqual({ availableEffect, fallbackReason: null });
  });

  it.each(["10.0.19045", "10.0.22000", "10.0.22620", "unknown"])("rejects unsupported Windows release %s", (release) => {
    expect(resolveBackgroundEffect({ ...environment, release }).fallbackReason).toBe("unsupported-platform");
  });

  it("uses Vibrancy on older macOS or when the native addon is unavailable", () => {
    expect(resolveBackgroundEffect({ ...environment, platform: "darwin", liquidGlassSupported: false }).availableEffect).toBe("vibrancy");
  });

  it.each([
    [{ memoryBytes: 4 * 1024 ** 3 }, "low-memory"],
    [{ cpuCount: 2 }, "low-cpu"],
    [{ gpuCompositing: undefined }, "gpu-pending"],
    [{ gpuCompositing: "disabled_software" }, "gpu-unavailable"],
    [{ gpuCompositing: "unavailable_software" }, "gpu-unavailable"],
    [{ reducedTransparency: true }, "reduced-transparency"],
    [{ highContrast: true }, "high-contrast"],
  ])("falls back when %j", (patch, fallbackReason) => {
    expect(resolveBackgroundEffect({ ...environment, ...patch })).toEqual({ availableEffect: null, fallbackReason });
  });
});

describe("native material lifecycle", () => {
  function setup() {
    const window = new BrowserWindow();
    const effects = createBackgroundEffects(() => window);
    return { window, effects };
  }

  it("waits for GPU info, enables Mica Alt, and actually disables it when toggled off", () => {
    const { window, effects } = setup();
    expect(effects.setTransparency(true).effect).toBe("solid");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalledWith("tabbed");
    app.emit("gpu-info-update");
    expect(effects.getState().effect).toBe("mica-alt");
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("tabbed");
    const off = effects.setTransparency(false);
    expect(off).toMatchObject({ effect: "solid", availableEffect: "mica-alt" });
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#141414");
    expect(effects.setTransparency(true).effect).toBe("mica-alt");
  });

  it("never calls the DWM material API on older Windows, even while GPU info is pending", () => {
    machine.release = "10.0.22000";
    const { window, effects } = setup();
    effects.setTransparency(true);
    app.emit("gpu-info-update");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(effects.getState().effect).toBe("solid");
  });

  it("does not reapply unchanged native materials or emit redundant updates", () => {
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    effects.setTransparency(true);
    vi.clearAllMocks();
    effects.refresh();
    app.emit("gpu-info-update");
    nativeTheme.emit("updated");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(window.webContents.send).not.toHaveBeenCalled();
  });

  it("reacts to GPU loss and accessibility changes without changing the saved preference", () => {
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    effects.setTransparency(true);
    machine.gpuCompositing = "disabled_software";
    app.emit("gpu-info-update");
    expect(effects.getState()).toMatchObject({ effect: "solid", fallbackReason: "gpu-unavailable" });
    expect(window.setBackgroundMaterial).toHaveBeenLastCalledWith("none");
    machine.gpuCompositing = "enabled";
    machine.reducedTransparency = true;
    nativeTheme.emit("updated");
    expect(effects.getState().fallbackReason).toBe("reduced-transparency");
    machine.reducedTransparency = false;
    nativeTheme.emit("updated");
    expect(effects.getState().effect).toBe("mica-alt");
  });

  it("keeps fallback backgrounds in sync with light/dark mode", () => {
    const { window, effects } = setup();
    effects.refresh();
    machine.dark = false;
    nativeTheme.emit("updated");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#ffffff");
  });

  it("uses an opaque native window for the Linux in-app blur", () => {
    platform("linux");
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    expect(effects.setTransparency(true).effect).toBe("gaussian-blur");
    expect(window.setBackgroundColor).toHaveBeenLastCalledWith("#141414");
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
    expect(window.setVibrancy).not.toHaveBeenCalled();
  });

  it("does not create Liquid Glass on a low-memory Mac", () => {
    platform("darwin");
    machine.memoryBytes = 4 * 1024 ** 3;
    const { effects } = setup();
    app.emit("gpu-info-update");
    expect(effects.setTransparency(true).fallbackReason).toBe("low-memory");
    expect(applyGlass).not.toHaveBeenCalled();
  });

  it("defers Liquid Glass until the page loads and preserves its restart-only transition", () => {
    platform("darwin");
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    vi.mocked(window.webContents.isLoadingMainFrame).mockReturnValue(true);
    expect(effects.setTransparency(true).effect).toBe("solid");
    expect(applyGlass).not.toHaveBeenCalled();
    vi.mocked(window.webContents.isLoadingMainFrame).mockReturnValue(false);
    expect(effects.refresh().effect).toBe("liquid-glass");
    expect(effects.setMacEffect("vibrancy")).toMatchObject({ effect: "liquid-glass", requiresRestart: true });
    effects.setTransparency(false);
    effects.setTransparency(true);
    expect(applyGlass).toHaveBeenCalledTimes(1);
  });

  it("turns Vibrancy off at the native layer", () => {
    platform("darwin");
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    effects.setMacEffect("vibrancy");
    effects.setTransparency(true);
    expect(window.setVibrancy).toHaveBeenLastCalledWith("under-window");
    effects.setTransparency(false);
    expect(window.setVibrancy).toHaveBeenLastCalledWith(null);
  });

  it("falls back on a native failure and does not retry the failing material", () => {
    const { window, effects } = setup();
    app.emit("gpu-info-update");
    vi.mocked(window.setBackgroundMaterial).mockImplementationOnce(() => { throw new Error("DWM unavailable"); });
    expect(effects.setTransparency(true)).toMatchObject({ effect: "solid", fallbackReason: "native-effect-failed" });
    vi.clearAllMocks();
    effects.refresh();
    effects.setTransparency(true);
    expect(window.setBackgroundMaterial).not.toHaveBeenCalled();
  });
});
