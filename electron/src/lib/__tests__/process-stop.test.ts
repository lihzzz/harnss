import { ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { stopProcessAndWait } from "@shared/lib/process-stop";

describe("process stop", () => {
  it("waits for a real child exit", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { windowsHide: true });
    await once(child, "spawn");
    await stopProcessAndWait(child);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    await expect(stopProcessAndWait(child)).resolves.toBeUndefined();
  });

  it("reports a signal failure and a missing exit instead of treating them as stopped", async () => {
    const failed = new ChildProcess();
    vi.spyOn(failed, "kill").mockReturnValue(false);
    await expect(stopProcessAndWait(failed)).rejects.toThrow("Could not signal");
    const stalled = new ChildProcess();
    vi.spyOn(stalled, "kill").mockReturnValue(true);
    await expect(stopProcessAndWait(stalled, 20)).rejects.toThrow("stop deadline");
  });

  it.skipIf(process.platform !== "win32")("stops an actual Windows child and grandchild before reporting completion", async () => {
    const script = `const {spawn}=require('node:child_process'); const grandchild=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{windowsHide:true,stdio:'ignore'}); grandchild.once('spawn',()=>process.stdout.write(String(grandchild.pid)+'\\n')); setTimeout(()=>{},10000);`;
    const child = spawn(process.execPath, ["-e", script], { windowsHide: true });
    if (!child.stdout) throw new Error("Missing fixture stdout");
    const chunks = await once(child.stdout, "data");
    const pid = Number(String(chunks[0]).trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);
    try {
      await stopProcessAndWait(child);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      if (child.exitCode === null && child.signalCode === null) await stopProcessAndWait(child);
      try { process.kill(pid); } catch { /* Grandchild already stopped. */ }
    }
  });
});
