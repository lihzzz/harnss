import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  executables: new Map<string, string>(),
  access: vi.fn(),
  version: vi.fn(() => "2.1.70\n"),
  sdkPath: vi.fn<() => string | undefined>(),
  install: vi.fn(),
}));

vi.mock("fs", () => ({ default: { accessSync: state.access, constants: { X_OK: 1 } } }));
vi.mock("os", () => ({ default: { homedir: () => path.resolve("fixture-home") } }));
vi.mock("child_process", () => ({ spawn: state.install }));
vi.mock("../app-settings", () => ({ getAppSetting: (key: string) => state.settings.get(key) ?? "" }));
vi.mock("../sdk", () => ({ getCliPath: state.sdkPath }));
vi.mock("../logger", () => ({ log: vi.fn() }));
vi.mock("../error-utils", () => ({ reportError: vi.fn(), extractErrorMessage: String }));
vi.mock("../command-launch", () => ({
  findExecutable: (command: string) => state.executables.get(command) ?? null,
  execFileExecutableSync: state.version,
}));

const localCli = path.resolve("fixture-home", ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
const sdkCli = path.resolve("fixture-app", "cli.js");
function allow(file: string) { state.executables.set(file, file); }
async function loadModule() { vi.resetModules(); return import("../claude-binary"); }

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CLAUDE_CODE_CLI_PATH", "");
  vi.stubEnv("CLAUDE_CLI_PATH", "");
  state.settings.clear(); state.settings.set("claudeBinarySource", "auto");
  state.executables.clear();
  state.access.mockImplementation((file: string) => { if (![...state.executables.values(), sdkCli].includes(file)) throw new Error("missing"); });
  state.version.mockReset(); state.version.mockReturnValue("2.1.70\n");
  state.sdkPath.mockReturnValue(sdkCli);
  state.install.mockReset();
});

describe("Claude binary selection", () => {
  it("uses a valid custom executable", async () => {
    const custom = path.resolve("custom agent", "claude.exe");
    state.settings.set("claudeBinarySource", "custom"); state.settings.set("claudeCustomBinaryPath", custom); allow(custom);
    expect(await (await loadModule()).getClaudeBinaryPath()).toBe(custom);
  });

  it("rejects an invalid custom path without silently changing the selected engine", async () => {
    state.settings.set("claudeBinarySource", "custom"); state.settings.set("claudeCustomBinaryPath", "missing");
    await expect((await loadModule()).getClaudeBinaryPath()).rejects.toThrow("not executable");
    expect(state.install).not.toHaveBeenCalled();
  });

  it("prefers an env override to native installation and PATH", async () => {
    const overridden = path.resolve("override", "claude.exe");
    vi.stubEnv("CLAUDE_CODE_CLI_PATH", overridden); allow(overridden); allow(localCli);
    expect(await (await loadModule()).getClaudeBinaryPath({ installIfMissing: false })).toBe(overridden);
  });

  it("finds the native installer directory even before PATH has refreshed", async () => {
    allow(localCli);
    const module = await loadModule();
    expect(await module.getClaudeBinaryPath({ installIfMissing: false })).toBe(localCli);
    expect(module.getClaudeBinaryMetadata()).toEqual({ path: localCli, strategy: "known", source: "auto" });
  });

  it("accepts the shared resolver's PATH shim result", async () => {
    const shim = path.resolve("npm", process.platform === "win32" ? "claude.cmd" : "claude");
    state.executables.set("claude", shim); allow(shim);
    expect(await (await loadModule()).getClaudeBinaryPath({ installIfMissing: false })).toBe(shim);
  });

  it("uses the bundled SDK only in auto mode", async () => {
    const module = await loadModule();
    expect(await module.getClaudeBinaryPath({ installIfMissing: false })).toBe(sdkCli);
    state.settings.set("claudeBinarySource", "managed");
    await expect(module.getClaudeBinaryPath({ installIfMissing: false })).rejects.toThrow("not found");
  });

  it("reports status without triggering installation", async () => {
    const module = await loadModule();
    expect(module.getClaudeBinaryStatus()).toEqual({ installed: false, installing: false });
    allow(localCli);
    expect(module.getClaudeBinaryStatus()).toEqual({ installed: true, installing: false });
    expect(state.install).not.toHaveBeenCalled();
  });

  it("uses the shared script/native version launcher and trims its output", async () => {
    const module = await loadModule();
    expect(await module.getClaudeVersion()).toBe("2.1.70");
    expect(state.version).toHaveBeenCalledWith(sdkCli, ["--version"], expect.objectContaining({ timeout: 10000 }));
    expect(await module.getClaudeVersion(localCli)).toBe("2.1.70");
    expect(state.version).toHaveBeenLastCalledWith(localCli, ["--version"], expect.any(Object));
  });
});
