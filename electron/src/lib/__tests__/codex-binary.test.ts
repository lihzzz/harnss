import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  paths: new Map<string, string>(),
  files: new Set<string>(),
  version: vi.fn(() => "codex 1.2.3\n"),
}));
vi.mock("electron", () => ({ app: { getPath: () => path.resolve("fixture-data") } }));
vi.mock("fs", () => ({ default: {
  mkdirSync: vi.fn(), constants: { X_OK: 1 },
  accessSync: (file: string) => { if (!state.files.has(file)) throw new Error("missing"); },
} }));
vi.mock("../app-settings", () => ({ getAppSetting: (key: string) => state.settings.get(key) ?? "" }));
vi.mock("../command-launch", () => ({
  findExecutable: (command: string) => state.paths.get(command) ?? null,
  execFileExecutableSync: state.version,
}));
vi.mock("../logger", () => ({ log: vi.fn() }));
vi.mock("../error-utils", () => ({ reportError: vi.fn() }));
async function load() { vi.resetModules(); return import("../codex-binary"); }
beforeEach(() => {
  vi.stubEnv("CODEX_CLI_PATH", "");
  state.settings.clear(); state.settings.set("codexBinarySource", "auto");
  state.paths.clear(); state.files.clear(); state.version.mockClear();
});

describe("Codex binary selection", () => {
  it("uses a single resolved PATH shim without treating where output as one path", async () => {
    const shim = path.resolve("npm shims", process.platform === "win32" ? "codex.cmd" : "codex");
    state.paths.set("codex", shim); state.files.add(shim);
    const module = await load();
    expect(module.isCodexInstalled()).toBe(true);
    expect(await module.getCodexBinaryPath()).toBe(shim);
    expect(await module.getCodexVersion()).toBe("codex 1.2.3");
    expect(state.version).toHaveBeenCalledWith(shim, ["--version"], expect.objectContaining({ timeout: 10000 }));
  });

  it("validates custom executable names through the same resolver", async () => {
    const resolved = path.resolve("custom", "codex.exe");
    state.settings.set("codexBinarySource", "custom"); state.settings.set("codexCustomBinaryPath", "codex-custom");
    state.paths.set("codex-custom", resolved); state.files.add(resolved);
    expect(await (await load()).getCodexBinaryPath()).toBe(resolved);
  });

  it("does not download when the explicit custom path is invalid", async () => {
    state.settings.set("codexBinarySource", "custom"); state.settings.set("codexCustomBinaryPath", "missing");
    const module = await load();
    expect(module.isCodexInstalled()).toBe(false);
    await expect(module.getCodexBinaryPath()).rejects.toThrow("not executable");
  });
});
