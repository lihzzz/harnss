import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ query: vi.fn<(input: { options?: Options }) => object>(() => ({})) }));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: state.query }));
vi.mock("electron", () => ({ app: { getVersion: () => "fixture" } }));
vi.mock("../app-settings", () => ({ getAppSetting: () => "fixture" }));
vi.mock("../logger", () => ({ log: vi.fn() }));
vi.mock("../error-utils", () => ({ reportError: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + "harnss-sdk-launch-")) throw new Error("Unexpected fixture path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Claude SDK process adapter", () => {
  it("executes the bundled script without an external Node PATH and retains stderr and arguments", async () => {
    const { getSDK } = await import("../sdk");
    const query = await getSDK();
    const stderr = vi.fn();
    query({ prompt: "fixture", options: { stderr } });
    const spawn = state.query.mock.lastCall?.[0].options?.spawnClaudeCodeProcess;
    if (!spawn) throw new Error("Missing SDK spawn adapter");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-sdk-launch-")); roots.push(root);
    const script = path.join(root, "bundled cli.js");
    fs.writeFileSync(script, "process.stdout.write(JSON.stringify(process.argv.slice(2)));process.stderr.write('fixture stderr')");
    const child = spawn({ command: "node", args: [script, "two words", "中文"], cwd: root, env: { PATH: "" }, signal: new AbortController().signal });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    await new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("exit", () => resolve()); });
    expect(JSON.parse(output)).toEqual(["two words", "中文"]);
    expect(stderr).toHaveBeenCalledWith("fixture stderr");
  });

  it.skipIf(process.platform !== "win32")("kills the SDK agent's Windows descendants through its synchronous kill interface", async () => {
    const { getSDK } = await import("../sdk");
    (await getSDK())({ prompt: "fixture" });
    const spawn = state.query.mock.lastCall?.[0].options?.spawnClaudeCodeProcess;
    if (!spawn) throw new Error("Missing SDK spawn adapter");
    const source = "const cp=require('node:child_process');const c=cp.spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:'ignore',windowsHide:true});c.once('spawn',()=>process.stdout.write(String(c.pid)));setTimeout(()=>{},10000)";
    const child = spawn({ command: process.execPath, args: ["-e", source], env: { ...process.env }, signal: new AbortController().signal });
    const pid = await new Promise<number>((resolve) => child.stdout.once("data", (chunk: Buffer) => resolve(Number(chunk.toString()))));
    const exited = new Promise<void>((resolve, reject) => { child.on("error", reject); child.on("exit", () => resolve()); });
    expect(child.kill("SIGTERM")).toBe(true);
    await exited;
    expect(() => process.kill(pid, 0)).toThrow();
    expect(child.killed).toBe(true);
  });
});
