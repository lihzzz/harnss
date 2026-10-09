import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HindsightServerOptions } from "@vectorize-io/hindsight-all";
import type { MemoryServer } from "./managed-server";

const mocks = vi.hoisted(() => ({
  settings: { enabled: true, localPort: 18888, llmProvider: "openai", llmModel: "test-model", llmBaseUrl: "http://localhost:11111/v1" },
  create: vi.fn<(module: unknown, options: HindsightServerOptions) => MemoryServer>(),
  key: vi.fn(() => undefined),
}));
vi.mock("../app-settings", () => ({ getAppSettings: () => ({ memory: mocks.settings }) }));
vi.mock("../logger", () => ({ log: vi.fn() }));
vi.mock("../error-utils", () => ({ reportError: (_label: string, error: unknown) => error instanceof Error ? error.message : String(error) }));
vi.mock("./secrets", () => ({ getMemoryLlmKey: mocks.key, hasMemoryLlmKey: () => false }));
vi.mock("../data-dir", () => ({ getDataDir: () => "audit-fixture" }));
vi.mock("node:child_process", () => ({ spawn: vi.fn(), spawnSync: () => ({ status: 0, stdout: "uv 0.10-test" }) }));
vi.mock("node:fs", () => ({ default: { readFileSync: () => { throw new Error("no fixture profile"); }, writeFileSync: vi.fn(), mkdirSync: vi.fn() } }));
vi.mock("@vectorize-io/hindsight-all", () => ({}));
vi.mock("./managed-server", () => ({ createManagedMemoryServer: mocks.create }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function serverFixture() {
  return { start: vi.fn<() => Promise<void>>(async () => undefined), checkHealth: vi.fn(async () => true), stop: vi.fn<() => Promise<void>>(async () => undefined) };
}
const environment = { ...process.env };
beforeEach(() => {
  vi.resetModules();
  mocks.settings.enabled = true;
  mocks.settings.llmModel = "test-model";
  mocks.create.mockReset();
});
afterEach(() => { process.env = { ...environment }; });

describe("memory daemon lifecycle", () => {
  it("coalesces cold starts and concurrent health checks", async () => {
    const server = serverFixture();
    mocks.create.mockReturnValue(server);
    const daemon = await import("./daemon");
    const start = daemon.startMemoryDaemon();
    expect(daemon.startMemoryDaemon()).toBe(start);
    await start;
    const health = deferred<boolean>();
    server.checkHealth.mockReturnValue(health.promise);
    const first = daemon.startMemoryDaemon();
    expect(daemon.startMemoryDaemon()).toBe(first);
    health.resolve(true);
    await first;
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(server.start).toHaveBeenCalledTimes(1);
    expect(server.checkHealth).toHaveBeenCalledTimes(1);
  });
  it("retains the existing server when a configuration-change stop fails", async () => {
    const previous = serverFixture();
    const next = serverFixture();
    mocks.create.mockReturnValueOnce(previous).mockReturnValue(next);
    const daemon = await import("./daemon");
    await daemon.startMemoryDaemon();
    mocks.settings.llmModel = "different-model";
    previous.stop.mockRejectedValueOnce(new Error("cannot stop"));
    await expect(daemon.startMemoryDaemon()).rejects.toThrow("cannot stop");
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(daemon.isMemoryDaemonReady()).toBe(false);
    await daemon.startMemoryDaemon();
    expect(previous.stop).toHaveBeenCalledTimes(2);
    expect(next.start).toHaveBeenCalledTimes(1);
  });
  it("retains a server after an explicit stop fails and permits retry", async () => {
    const server = serverFixture();
    mocks.create.mockReturnValue(server);
    const daemon = await import("./daemon");
    await daemon.startMemoryDaemon();
    server.stop.mockRejectedValueOnce(new Error("stop timed out"));
    await expect(daemon.stopMemoryDaemon()).rejects.toThrow("stop timed out");
    expect((await daemon.getMemoryDaemonStatus()).running).toBe(true);
    await daemon.stopMemoryDaemon();
    expect(server.stop).toHaveBeenCalledTimes(2);
  });
  it("waits for an in-flight startup before stopping without advertising ready", async () => {
    const startup = deferred<void>();
    const created = deferred<void>();
    const server = serverFixture();
    server.start.mockImplementation(() => { created.resolve(); return startup.promise; });
    mocks.create.mockReturnValue(server);
    const daemon = await import("./daemon");
    const start = daemon.startMemoryDaemon();
    await created.promise;
    const stop = daemon.stopMemoryDaemon();
    expect(daemon.stopMemoryDaemon()).toBe(stop);
    startup.resolve();
    await Promise.all([start, stop]);
    expect(server.stop).toHaveBeenCalledTimes(1);
    expect(daemon.isMemoryDaemonReady()).toBe(false);
  });
  it("cleans up a failed start and retains the handle if cleanup also fails", async () => {
    const server = serverFixture();
    server.start.mockRejectedValueOnce(new Error("startup timed out"));
    server.stop.mockRejectedValueOnce(new Error("cleanup failed"));
    mocks.create.mockReturnValue(server);
    const daemon = await import("./daemon");
    await expect(daemon.startMemoryDaemon()).rejects.toThrow("startup and cleanup failed");
    await daemon.stopMemoryDaemon();
    expect(server.stop).toHaveBeenCalledTimes(2);
  });
});
