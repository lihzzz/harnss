import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAppSetting } = vi.hoisted(() => ({
  mockGetAppSetting: vi.fn(),
}));

vi.mock("../app-settings", () => ({
  getAppSetting: mockGetAppSetting,
}));

async function loadModule() {
  vi.resetModules();
  return import("../computer-use-runtime");
}

describe("computer-use runtime configuration", () => {
  beforeEach(() => {
    mockGetAppSetting.mockReset();
    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "computerUseEnabled") return false;
      if (key === "computerUseBinaryPath") return "";
      return undefined;
    });
  });

  it("does not inject a server when the runtime is disabled", async () => {
    const { getComputerUseMcpServer, withComputerUseMcpServer } = await loadModule();
    const configured = [{ name: "filesystem", transport: "stdio" as const, command: "fs" }];

    expect(getComputerUseMcpServer()).toBeNull();
    expect(withComputerUseMcpServer(configured)).toEqual(configured);
  });

  it("uses the configured external driver and preserves an existing server", async () => {
    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "computerUseEnabled") return true;
      if (key === "computerUseBinaryPath") return "/opt/bin/cua-driver";
      return undefined;
    });

    const { getComputerUseMcpServer, getCodexMcpServerOverrides, withComputerUseMcpServer } = await loadModule();
    const runtime = getComputerUseMcpServer();
    expect(runtime).toEqual({
      name: "harnss_cua",
      transport: "stdio",
      command: "/opt/bin/cua-driver",
      args: ["mcp"],
    });
    expect(getCodexMcpServerOverrides({
      ...runtime!,
      env: { ELECTRON_RUN_AS_NODE: "1" },
    })).toEqual([
      "-c", 'mcp_servers.harnss_cua.command="/opt/bin/cua-driver"',
      "-c", 'mcp_servers.harnss_cua.args=["mcp"]',
      "-c", 'mcp_servers.harnss_cua.env.ELECTRON_RUN_AS_NODE="1"',
      "-c", "mcp_servers.harnss_cua.enabled=true",
    ]);

    const configured = [runtime!, { name: "filesystem", transport: "stdio" as const, command: "fs" }];
    expect(withComputerUseMcpServer(configured)).toEqual(configured);
  });

  it("appends the bundled server without mutating the input list", async () => {
    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "computerUseEnabled") return true;
      if (key === "computerUseBinaryPath") return "";
      return undefined;
    });

    const { withComputerUseMcpServer } = await loadModule();
    const configured = [{ name: "filesystem", transport: "stdio" as const, command: "fs" }];
    const result = withComputerUseMcpServer(configured);

    expect(configured).toEqual([{ name: "filesystem", transport: "stdio", command: "fs" }]);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ name: "harnss_cua", transport: "stdio" });
  });

  it("marks the bundled Electron helper as a Node process", async () => {
    mockGetAppSetting.mockImplementation((key: string) => {
      if (key === "computerUseEnabled") return true;
      if (key === "computerUseBinaryPath") return "";
      return undefined;
    });

    const versions = process.versions as unknown as Record<string, string | undefined>;
    const hadElectronVersion = Object.prototype.hasOwnProperty.call(versions, "electron");
    const previousElectronVersion = versions.electron;
    Object.defineProperty(versions, "electron", { configurable: true, value: "40.0.0" });
    try {
      const { getComputerUseMcpServer } = await loadModule();
      expect(getComputerUseMcpServer()?.env).toEqual({ ELECTRON_RUN_AS_NODE: "1" });
    } finally {
      if (hadElectronVersion) {
        Object.defineProperty(versions, "electron", { configurable: true, value: previousElectronVersion });
      } else {
        delete versions.electron;
      }
    }
  });
});
