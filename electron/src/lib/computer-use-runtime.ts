import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import type { McpServerInput } from "@shared/lib/mcp-config";
import type { ComputerUseRuntimeStatus } from "@shared/types/computer-use";
import { getAppSetting } from "./app-settings";

export const COMPUTER_USE_MCP_SERVER_NAME = "harnss_cua";

type RuntimeInvocation = {
  command: string;
  args: string[];
  env?: Record<string, string>;
  mode: "internal" | "external";
};

function configuredExternalCommand(): string {
  return getAppSetting("computerUseBinaryPath").trim();
}

function internalInvocation(): RuntimeInvocation {
  const sourceHelperPath = path.join(__dirname, "computer-use-mcp.js");
  // Native Cua bindings must be loaded from outside app.asar so their dylib/
  // shared-library paths are real filesystem paths rather than ASAR URLs.
  const helperPath = sourceHelperPath.replace(/app\.asar([/\\])/, "app.asar.unpacked$1");
  const isElectron = Boolean(process.versions.electron);
  return {
    command: process.execPath,
    args: [helperPath],
    env: isElectron ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
    mode: "internal",
  };
}

function runtimeInvocation(): RuntimeInvocation {
  const externalCommand = configuredExternalCommand();
  if (externalCommand) {
    return { command: externalCommand, args: ["mcp"], mode: "external" };
  }
  return internalInvocation();
}

/** Return the stdio MCP definition shared by Claude, ACP, and Codex sessions. */
export function getComputerUseMcpServer(): McpServerInput | null {
  if (!getAppSetting("computerUseEnabled")) return null;
  const invocation = runtimeInvocation();
  return {
    name: COMPUTER_USE_MCP_SERVER_NAME,
    transport: "stdio",
    command: invocation.command,
    args: invocation.args,
    ...(invocation.env ? { env: invocation.env } : {}),
  };
}

/** Add the runtime server without replacing an explicitly configured server. */
export function withComputerUseMcpServer(servers: McpServerInput[] | undefined): McpServerInput[] {
  const existing = servers ? [...servers] : [];
  const runtime = getComputerUseMcpServer();
  if (!runtime || existing.some((server) => server.name === runtime.name)) return existing;
  return [...existing, runtime];
}

/** Build Codex app-server overrides for a stdio MCP server without editing config.toml. */
export function getCodexMcpServerOverrides(server: McpServerInput): string[] {
  const prefix = `mcp_servers.${server.name}`;
  const args = [
    "-c", `${prefix}.command=${JSON.stringify(server.command ?? "")}`,
    "-c", `${prefix}.args=${JSON.stringify(server.args ?? [])}`,
  ];
  for (const [name, value] of Object.entries(server.env ?? {})) {
    args.push("-c", `${prefix}.env.${name}=${JSON.stringify(value)}`);
  }
  args.push("-c", `${prefix}.enabled=true`);
  return args;
}

function readExternalVersion(command: string): { installed: boolean; version?: string; error?: string } {
  if (/[\\/]/.test(command) && !fs.existsSync(command)) {
    return { installed: false, error: "Cua Driver executable was not found at the configured path." };
  }

  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    });
    if (result.error) return { installed: false, error: result.error.message };
    if (result.status !== 0) {
      return { installed: false, error: (result.stderr || result.stdout || `Exited with code ${result.status}`).trim() };
    }
    const version = (result.stdout || result.stderr || "").trim().split("\n")[0];
    return { installed: true, ...(version ? { version } : {}) };
  } catch (error) {
    return { installed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function readInternalVersion(invocation: RuntimeInvocation): { installed: boolean; version?: string; error?: string } {
  try {
    const result = spawnSync(invocation.command, [...invocation.args, "--health"], {
      encoding: "utf8",
      timeout: 10000,
      windowsHide: true,
      env: { ...process.env, ...invocation.env },
    });
    if (result.error) return { installed: false, error: result.error.message };
    if (result.status !== 0) {
      return { installed: false, error: (result.stderr || result.stdout || `Exited with code ${result.status}`).trim() };
    }
    const metadata = JSON.parse(result.stdout || "{}");
    return { installed: true, version: typeof metadata.driverVersion === "string" ? metadata.driverVersion : undefined };
  } catch (error) {
    return { installed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function getComputerUseRuntimeStatus(): Promise<ComputerUseRuntimeStatus> {
  const enabled = getAppSetting("computerUseEnabled");
  const invocation = runtimeInvocation();
  if (!enabled) {
    return { enabled, command: invocation.command, mode: invocation.mode, installed: false, ready: false };
  }
  const result = invocation.mode === "external"
    ? readExternalVersion(invocation.command)
    : readInternalVersion(invocation);
  const permissions = process.platform === "darwin"
    ? await readMacPermissions()
    : undefined;
  const permissionsReady = !permissions || (permissions.accessibility && permissions.screenRecording);
  return {
    enabled,
    command: invocation.command,
    mode: invocation.mode,
    installed: result.installed,
    ready: result.installed && permissionsReady,
    ...(permissions ? { permissions } : {}),
    ...result,
  };
}

async function readMacPermissions(): Promise<ComputerUseRuntimeStatus["permissions"]> {
  try {
    const cua = await import("@trycua/cua-driver");
    return cua.currentMacOsPermissionStatus();
  } catch {
    return undefined;
  }
}

/** Ask macOS for the native permissions required by the Cua runtime. */
export async function requestComputerUsePermissions(): Promise<ComputerUseRuntimeStatus["permissions"]> {
  if (process.platform !== "darwin") return undefined;
  try {
    const permissions = await import("@trycua/cua-driver/electron");
    return permissions.requestMacOSPermissions();
  } catch {
    return undefined;
  }
}
