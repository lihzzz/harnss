import type { ChildProcess } from "node:child_process";

/** Sending a signal is not confirmation that the process has exited. */
export function stopProcessAndWait(process: ChildProcess, timeoutMs = 5_000): Promise<void> {
  if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      process.off("exit", exited);
      process.off("error", failed);
      if (error) reject(error); else resolve();
    };
    const exited = () => finish();
    const failed = (error: Error) => finish(error);
    const timer = setTimeout(() => finish(new Error("Agent process did not exit before the stop deadline")), timeoutMs);
    process.once("exit", exited);
    process.once("error", failed);
    try { if (!process.kill()) finish(new Error("Could not signal the agent process")); }
    catch (error) { finish(error instanceof Error ? error : new Error("Could not stop the agent process")); }
  });
}
