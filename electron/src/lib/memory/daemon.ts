import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { HindsightServer } from "@vectorize-io/hindsight-all";
import type { MemoryDaemonStatus } from "@shared/types/memory";
import { getAppSettings } from "../app-settings";
import { log } from "../logger";
import { reportError } from "../error-utils";
import { getMemoryLlmKey, hasMemoryLlmKey } from "./secrets";
import { getDataDir } from "../data-dir";

let server: HindsightServer | null = null;
let serverKey = "";
let effectiveLlm: Pick<MemoryDaemonStatus, "provider" | "model" | "llmBaseUrl"> | null = null;
let startPromise: Promise<void> | null = null;
let lastError: string | undefined;
let daemonReady = false;
let stopRequested = false;

function uvCandidates(): string[] {
  const home = os.homedir();
  return process.platform === "win32"
    ? [path.join(home, ".local", "bin", "uv.exe"), path.join(process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "uv", "uv.exe")]
    : [path.join(home, ".local", "bin", "uv"), path.join(home, ".cargo", "bin", "uv")];
}

function uvxCandidates(): string[] {
  return uvCandidates().map((command) => command.replace(/uv(?:\.exe)?$/, process.platform === "win32" ? "uvx.exe" : "uvx"));
}

function addCommandDirectory(command: string): void {
  const directory = path.dirname(command);
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  if (!pathEntries.includes(directory)) process.env.PATH = [directory, ...pathEntries].join(path.delimiter);
}

function removeProfileApiKey(profileEnv: string): void {
  try {
    const lines = fs.readFileSync(profileEnv, "utf8").split(/\r?\n/);
    fs.writeFileSync(profileEnv, lines.filter((line) => !line.startsWith("HINDSIGHT_API_LLM_API_KEY=")).join("\n"), { mode: 0o600 });
  } catch {
    // The profile may not exist on first start.
  }
}

function writeProfileApiKey(profileEnv: string, apiKey: string): void {
  fs.mkdirSync(path.dirname(profileEnv), { recursive: true, mode: 0o700 });
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(profileEnv, "utf8").split(/\r?\n/);
  } catch {
    // The profile file is created by hindsight-all on the first start.
  }
  const filtered = lines.filter((line) => !line.startsWith("HINDSIGHT_API_LLM_API_KEY="));
  filtered.push(`HINDSIGHT_API_LLM_API_KEY=${apiKey}`);
  fs.writeFileSync(profileEnv, `${filtered.filter(Boolean).join("\n")}\n`, { mode: 0o600 });
}

export function getUvStatus(): MemoryDaemonStatus["uv"] {
  let uvVersion: string | undefined;
  for (const command of ["uv", ...uvCandidates()]) {
    try {
      const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      if (!result.error && result.status === 0) {
        addCommandDirectory(command);
        uvVersion = (result.stdout || "").trim().split(/\r?\n/)[0];
        break;
      }
    } catch {
      // Try the next known installation path.
    }
  }
  if (!uvVersion) return { installed: false, error: "uv is not available. Install it from https://docs.astral.sh/uv/getting-started/installation/" };
  for (const command of ["uvx", ...uvxCandidates()]) {
    try {
      const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
      if (!result.error && result.status === 0) {
        addCommandDirectory(command);
        return { installed: true, version: uvVersion };
      }
    } catch {
      // Try the next known installation path.
    }
  }
  return { installed: false, version: uvVersion, error: "uvx is not available. Reinstall uv from https://docs.astral.sh/uv/getting-started/installation/" };
}

export function isMemoryDaemonReady(): boolean {
  return daemonReady;
}

export async function installMemoryDependencies(): Promise<{ ok: boolean; error?: string }> {
  if (getUvStatus().installed) return { ok: true };
  const command = process.platform === "win32"
    ? { file: "powershell", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://astral.sh/uv/install.ps1 | iex"] }
    : { file: "sh", args: ["-c", "curl -LsSf https://astral.sh/uv/install.sh | sh"] };
  return new Promise((resolve) => {
    const child = spawn(command.file, command.args, { stdio: "ignore", windowsHide: true });
    child.once("error", (error) => resolve({ ok: false, error: error.message }));
    child.once("close", (code) => {
      const status = getUvStatus();
      resolve(code === 0 && status.installed ? { ok: true } : { ok: false, error: status.error ?? `uv installer exited with code ${code ?? "unknown"}` });
    });
  });
}

function settingsKey(): string {
  const settings = getAppSettings().memory;
  return JSON.stringify({
    port: settings.localPort,
    provider: settings.llmProvider,
    model: settings.llmModel,
    baseUrl: settings.llmBaseUrl,
    key: getMemoryLlmKey(),
  });
}

export function getMemoryBaseUrl(): string {
  return `http://127.0.0.1:${getAppSettings().memory.localPort}`;
}

export async function startMemoryDaemon(): Promise<void> {
  // Coalesce concurrent callers before touching an in-flight server. This is
  // important during app startup when settings, a session, and the UI can all
  // request a health check at once.
  if (startPromise) return startPromise;
  stopRequested = false;
  const settings = getAppSettings().memory;
  if (!settings.enabled) throw new Error("Long-term memory is disabled");
  const uv = getUvStatus();
  if (!uv.installed) throw new Error(uv.error ?? "uv is required to start Hindsight");

  const nextKey = settingsKey();
  if (server && serverKey === nextKey) {
    const activeServer = server;
    if (await activeServer.checkHealth() && !stopRequested && server === activeServer) {
      daemonReady = true;
      return;
    }
  }
  if (stopRequested) return;
  daemonReady = false;
  if (server) {
    await server.stop().catch(() => undefined);
    server = null;
  }
  startPromise = (async () => {
    const hindsight = await import("@vectorize-io/hindsight-all");
    const llmKey = getMemoryLlmKey();
    const hindsightHome = path.join(getDataDir(), "hindsight");
    const profileEnv = path.join(hindsightHome, ".hindsight", "profiles", "harnss.env");
    removeProfileApiKey(profileEnv);
    server = new hindsight.HindsightServer({
      profile: "harnss",
      embedVersion: "0.10.2",
      host: "127.0.0.1",
      port: settings.localPort,
      env: {
        HINDSIGHT_API_LLM_PROVIDER: settings.llmProvider,
        HINDSIGHT_API_LLM_MODEL: settings.llmModel,
        HINDSIGHT_API_LLM_BASE_URL: settings.llmBaseUrl,
        HINDSIGHT_API_MCP_ENABLED: "true",
        HINDSIGHT_API_HOST: "127.0.0.1",
        // hindsight-embed resolves its profile and pg0 paths from HOME. Keep
        // the embedded database inside Electron's app data directory.
        HOME: hindsightHome,
        USERPROFILE: hindsightHome,
      },
      // The first uvx launch downloads the embedded Python stack (the local
      // probe took almost three minutes before timing out). Keep this window
      // long enough for a cold install while subsequent starts still health
      // check immediately.
      readyTimeoutMs: 300000,
      readyPollIntervalMs: 1000,
      logger: {
        debug: (message) => log("MEMORY_DAEMON", message),
        info: (message) => log("MEMORY_DAEMON", message),
        warn: (message) => log("MEMORY_DAEMON_WARN", message),
        error: (message) => log("MEMORY_DAEMON_ERR", message),
      },
    });
    try {
      await server.start();
      if (stopRequested) return;
      if (llmKey) {
        // hindsight-all forwards userEnv as --env arguments. Start once with
        // provider settings only, then place the key in the profile env file
        // for the daemon restart; this keeps the key out of both argv and the
        // Electron process environment.
        await server.stop();
        if (stopRequested) return;
        writeProfileApiKey(profileEnv, llmKey);
        await server.start();
      }
    } finally {
      removeProfileApiKey(profileEnv);
    }
    if (stopRequested) {
      const started = server;
      server = null;
      await started.stop().catch(() => undefined);
      return;
    }
    // hindsight-all 0.10 writes all supplied env values to the profile env
    // file. Remove the LLM key after startup so it remains encrypted at rest
    // in Harnss, while the already-running daemon keeps its process env.
    removeProfileApiKey(profileEnv);
    serverKey = nextKey;
    effectiveLlm = { provider: settings.llmProvider, model: settings.llmModel, llmBaseUrl: settings.llmBaseUrl };
    daemonReady = true;
    lastError = undefined;
  })().catch((error) => {
    server = null;
    daemonReady = false;
    lastError = reportError("MEMORY_DAEMON_START", error);
    throw error;
  }).finally(() => {
    startPromise = null;
  });
  return startPromise;
}

export async function stopMemoryDaemon(): Promise<void> {
  stopRequested = true;
  const pending = startPromise;
  if (pending) await pending.catch(() => undefined);
  const current = server;
  server = null;
  effectiveLlm = null;
  daemonReady = false;
  serverKey = "";
  if (current) await current.stop().catch((error) => log("MEMORY_DAEMON_STOP", error));
}

export async function checkMemoryDaemon(): Promise<boolean> {
  if (server) return server.checkHealth().catch(() => false);
  try {
    const response = await fetch(`${getMemoryBaseUrl()}/health`, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getMemoryDaemonStatus(): Promise<MemoryDaemonStatus> {
  const settings = getAppSettings().memory;
  const healthy = settings.enabled && await checkMemoryDaemon();
  return {
    enabled: settings.enabled,
    running: !!server || healthy,
    healthy,
    baseUrl: getMemoryBaseUrl(),
    port: settings.localPort,
    uv: getUvStatus(),
    hasLlmKey: hasMemoryLlmKey(),
    ...(server && effectiveLlm ? effectiveLlm : { provider: settings.llmProvider, model: settings.llmModel, llmBaseUrl: settings.llmBaseUrl }),
    ...(lastError ? { error: lastError } : {}),
  };
}

export async function ensureMemoryDaemon(): Promise<boolean> {
  try {
    await startMemoryDaemon();
    return true;
  } catch {
    return false;
  }
}
