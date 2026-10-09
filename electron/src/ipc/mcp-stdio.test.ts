import { beforeEach, describe, expect, it, vi } from "vitest";
import { probeStdioServer } from "./mcp";
const state = vi.hoisted(() => ({ find: vi.fn<(...args: unknown[]) => string | null>() }));
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));
vi.mock("../lib/command-launch", () => ({ findExecutable: state.find }));
vi.mock("../lib/mcp-store", () => ({}));
vi.mock("../lib/mcp-oauth-flow", () => ({}));
vi.mock("../lib/mcp-oauth-store", () => ({}));
vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/posthog", () => ({}));
vi.mock("../lib/error-utils", () => ({}));
beforeEach(() => state.find.mockReset());
describe("stdio MCP command availability", () => {
  it("resolves explicit Windows executables with server environment", () => {
    state.find.mockReturnValue("C:\\tools\\uvx.exe");
    expect(probeStdioServer({ name: "local", transport: "stdio", command: "C:\\tools\\uvx.exe", env: { PATH: "C:\\tools" } }).status).toBe("connected");
    expect(state.find).toHaveBeenCalledWith("C:\\tools\\uvx.exe", expect.objectContaining({ env: expect.objectContaining({ PATH: "C:\\tools" }) }));
  });
  it.each(["node", "npx", "bunx", "pnpx", "uvx"])("does not claim a missing %s is available", (command) => {
    state.find.mockReturnValue(null);
    expect(probeStdioServer({ name: "missing", transport: "stdio", command }).status).toBe("failed");
  });
});
