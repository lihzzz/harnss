import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveExecutableCommand } from "../command-launch";
import { ProductivityError } from "../productivity-errors";
import { writeTextAtomically } from "../atomic-file";
import { WINDOWS_JOB_HELPER, quoteWindowsArgument } from "./windows-job";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export interface ManagedProcess {
  child: ChildProcess;
  closed: Promise<number | null>;
  alive(): boolean;
  ownsPort(port: number, address: string, checkedAfter: number): Promise<boolean>;
  stop(): Promise<void>;
}
function groupAlive(pid: number): boolean {
  try { process.kill(-pid, 0); return true; } catch { return false; }
}
function execute(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => execFile(file, args, { timeout: 2000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => resolve(error ? "" : stdout)));
}
export function matchesListenerAddress(listener: string, address: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/^::ffff:/, "");
  const actual = normalize(address); const bound = normalize(listener);
  return bound === actual || (bound === "0.0.0.0" && !actual.includes(":")) || (bound === "::" && actual.includes(":"));
}
function procAddress(encoded: string): string {
  const words = encoded.match(/.{8}/g) ?? [];
  const bytes = words.flatMap((word) => (word.match(/.{2}/g) ?? []).reverse().map((hex) => parseInt(hex, 16)));
  if (bytes.length === 4) return bytes.join(".");
  if (bytes.every((byte) => byte === 0)) return "::";
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return "::1";
  if (bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 255 && bytes[11] === 255) return bytes.slice(12).join(".");
  return Array.from({ length: 8 }, (_, index) => ((bytes[index * 2] << 8) + bytes[index * 2 + 1]).toString(16)).join(":");
}
async function unixGroupOwnsPort(groupId: number, port: number, address: string): Promise<boolean> {
  if (process.platform === "linux") {
    try {
      const inodes = new Set<string>();
      for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        const lines = (await fs.readFile(table, "utf8")).split("\n").slice(1);
        for (const line of lines) {
          const fields = line.trim().split(/\s+/); const [encodedAddress, encodedPort] = fields[1]?.split(":") ?? [];
          if (fields[3] === "0A" && parseInt(encodedPort ?? "", 16) === port && fields[9] && encodedAddress && matchesListenerAddress(procAddress(encodedAddress), address)) inodes.add(fields[9]);
        }
      }
      if (!inodes.size) return false;
      for (const id of (await fs.readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
        try {
          const stat = await fs.readFile(`/proc/${id}/stat`, "utf8"); const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
          if (Number(fields[2]) !== groupId) continue;
          for (const fd of await fs.readdir(`/proc/${id}/fd`)) {
            try { const target = await fs.readlink(`/proc/${id}/fd/${fd}`); const match = /^socket:\[(\d+)\]$/.exec(target); if (match && inodes.has(match[1])) return true; }
            catch { /* Descriptor closed while scanning. */ }
          }
        } catch { /* Process exited or is inaccessible. */ }
      }
    } catch { return false; }
    return false;
  }
  const family = address.includes(":") ? "6" : "4";
  const listeners = await execute("/usr/sbin/lsof", ["-nP", `-i${family}TCP:${port}`, "-sTCP:LISTEN", "-Fpn"]);
  let listenerPid = "";
  for (const line of listeners.split("\n")) {
    if (/^p\d+$/.test(line)) { listenerPid = line.slice(1); continue; }
    if (!line.startsWith("n") || !listenerPid) continue;
    const bound = line.slice(1).replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (bound !== "*" && !matchesListenerAddress(bound, address)) continue;
    const actualGroup = await execute("/bin/ps", ["-o", "pgid=", "-p", listenerPid]);
    if (Number(actualGroup.trim()) === groupId) return true;
  }
  return false;
}
export async function spawnManagedProcess(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, helperRoot: string, expectedPort: number | null = null): Promise<ManagedProcess> {
  const resolved = resolveExecutableCommand(command, args, { cwd, env });
  let child: ChildProcess;
  const statusFile = path.join(helperRoot, `ownership-${randomUUID()}.json`);
  if (process.platform === "win32") {
    await fs.mkdir(helperRoot, { recursive: true });
    const helperFile = path.join(helperRoot, "windows-job-v1.ps1");
    // The file is host-generated source, never imported project content.
    await writeTextAtomically(helperFile, WINDOWS_JOB_HELPER);
    const commandLine = [quoteWindowsArgument(resolved.command), ...resolved.args.map((arg) => resolved.windowsVerbatimArguments ? arg : quoteWindowsArgument(arg))].join(" ");
    const payload = Buffer.from(JSON.stringify({ executable: resolved.command, commandLine, cwd, port: expectedPort ?? 0, statusFile }), "utf8").toString("base64");
    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    child = spawn(path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helperFile, "-Payload", payload], {
      cwd, env: resolved.env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
  } else {
    child = spawn(resolved.command, resolved.args, { cwd, env: resolved.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  }
  let exited = false;
  let spawnError: Error | null = null;
  const closed = new Promise<number | null>((resolve) => {
    child.once("error", (error) => { spawnError = error; exited = true; resolve(null); });
    child.once("close", (code) => { exited = true; resolve(code); });
  });
  await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); });
  const pid = child.pid;
  if (!pid) throw spawnError ?? new ProductivityError("SPAWN_FAILED", "The process did not receive an ID");
  let stopping: Promise<void> | null = null;
  const alive = () => process.platform === "win32" ? !exited : groupAlive(pid);
  const waitClosed = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([closed, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProductivityError("STOP_FAILED", "Application output pipes remain open after stopping its process group", true)), 2000);
      })]);
    } finally { if (timer) clearTimeout(timer); if (process.platform === "win32") await fs.unlink(statusFile).catch(() => {}); }
  };
  return {
    child, closed, alive,
    ownsPort: async (port, address, checkedAfter) => {
      if (!alive()) return false;
      if (process.platform !== "win32") return unixGroupOwnsPort(pid, port, address);
      if (port !== expectedPort) return false;
      try {
        const deadline = Date.now() + 750;
        while (Date.now() < deadline && alive()) {
          const stat = await fs.stat(statusFile);
          if (stat.mtimeMs >= checkedAfter) return (await fs.readFile(statusFile, "utf8")).split("\n").some((listener) => matchesListenerAddress(listener, address));
          await pause(50);
        }
        return false;
      } catch { return false; }
    },
    stop: () => {
      if (stopping) return stopping;
      const attempt = async () => {
        if (!alive()) { await waitClosed(); return; }
        if (process.platform === "win32") {
          // The helper owns the entire Job, including grandchildren after their
          // wrapper has exited. Closing its stdin also kills the Job on parent loss.
          child.stdin?.end("stop\n");
        } else { try { process.kill(-pid, "SIGTERM"); } catch { /* Already exited. */ } }
        const gracefulDeadline = Date.now() + 5000;
        while (alive() && Date.now() < gracefulDeadline) await pause(50);
        if (alive()) {
          if (process.platform === "win32") child.kill(); // Closing the helper's Job handle terminates descendants.
          else { try { process.kill(-pid, "SIGKILL"); } catch { /* Already exited. */ } }
        }
        const deadline = Date.now() + 5000;
        while (alive() && Date.now() < deadline) await pause(50);
        if (alive()) throw new ProductivityError("STOP_FAILED", "The application process tree is still alive", true);
        await waitClosed();
      };
      stopping = attempt().catch((error: unknown) => { stopping = null; throw error; });
      return stopping;
    },
  };
}
