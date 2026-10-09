import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as hindsight from "@vectorize-io/hindsight-all";
import type { HindsightServerOptions } from "@vectorize-io/hindsight-all";
import { createManagedMemoryServer } from "./managed-server";

const mocks = vi.hoisted(() => ({
  options: vi.fn<(options: HindsightServerOptions) => void>(),
  start: vi.fn(async () => undefined),
  health: vi.fn(async () => true),
  libraryStop: vi.fn(async () => undefined),
  execute: vi.fn<(command: string, args: string[], options: { env: NodeJS.ProcessEnv; timeout: number; windowsHide: boolean }, callback: (error: Error | null) => void) => void>(),
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execute }));
vi.mock("@vectorize-io/hindsight-all", () => ({
  HindsightServer: class {
    constructor(options: HindsightServerOptions) { mocks.options(options); }
    start = mocks.start;
    checkHealth = mocks.health;
    stop = mocks.libraryStop;
  },
  getEmbedCommand: (options: HindsightServerOptions) => ["uvx", `hindsight-embed@${options.embedVersion}`],
}));
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
beforeEach(() => { vi.clearAllMocks(); mocks.execute.mockImplementation((_command, _args, _options, callback) => callback(null)); });
afterEach(() => Object.defineProperty(process, "platform", originalPlatform));

describe("managed Hindsight stop", () => {
  it.each(["win32", "darwin"])("uses the startup profile and private HOME on %s", async (platform) => {
    Object.defineProperty(process, "platform", { configurable: true, value: platform });
    const homeBefore = process.env.HOME;
    const userBefore = process.env.USERPROFILE;
    const env = { HOME: "private-home", USERPROFILE: "private-home", HINDSIGHT_API_HOST: "127.0.0.1" };
    const server = createManagedMemoryServer(hindsight, { embedVersion: "0.10.2", profile: "harnss", env });
    await server.start();
    await server.stop();
    expect(mocks.options).toHaveBeenCalledWith(expect.objectContaining({ env, profile: "harnss" }));
    expect(mocks.execute).toHaveBeenCalledWith("uvx", ["hindsight-embed@0.10.2", "daemon", "--profile", "harnss", "stop"], expect.objectContaining({ env: expect.objectContaining(env), timeout: 10000, windowsHide: true }), expect.any(Function));
    if (platform === "darwin") expect(mocks.execute.mock.calls[0][2].env.HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU).toBe("1");
    expect(process.env.HOME).toBe(homeBefore);
    expect(process.env.USERPROFILE).toBe(userBefore);
    expect(mocks.libraryStop).not.toHaveBeenCalled();
  });
  it.each(["exit code 1", "spawn ENOENT", "timed out"])("propagates %s to lifecycle management", async (message) => {
    mocks.execute.mockImplementation((_command, _args, _options, callback) => callback(new Error(message)));
    const server = createManagedMemoryServer(hindsight, { embedVersion: "0.10.2" });
    await expect(server.stop()).rejects.toThrow(message);
  });
});
