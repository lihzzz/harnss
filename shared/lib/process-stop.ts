import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import path from "node:path";

const pendingStops = new WeakMap<ChildProcess, Promise<void>>();

/** Sending a signal is not confirmation that the process has exited. */
export function stopProcessAndWait(child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  const pending = pendingStops.get(child);
  if (pending) return pending;
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const result = new Promise<void>((resolve, reject) => {
    let finished = false;
    let observedExit = false;
    let treeStopped = process.platform !== "win32";
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      child.off("exit", exited);
      child.off("error", failed);
      if (error) reject(error); else resolve();
    };
    const exited = () => { observedExit = true; if (treeStopped) finish(); };
    const failed = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error("Agent process did not exit before the stop deadline")), timeoutMs);
    child.once("exit", exited);
    child.once("error", failed);
    if (process.platform === "win32" && child.pid) {
      const taskkill = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      // Terminate descendants before their parent disappears; waiting only for the
      // parent's exit does not prove a Windows shell/agent has stopped its children.
      execFile(taskkill, ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, timeout: timeoutMs }, (error) => {
        treeStopped = true;
        if (error) finish(error);
        else if (observedExit) finish();
      });
      return;
    }
    treeStopped = true;
    try { if (!child.kill()) finish(new Error("Could not signal the agent process")); }
    catch (error) { finish(error instanceof Error ? error : new Error("Could not stop the agent process")); }
  });
  pendingStops.set(child, result);
  void result.then(() => pendingStops.delete(child), () => pendingStops.delete(child));
  return result;
}
