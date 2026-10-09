import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { spawnExecutable } from "../command-launch";
import { stopProcessAndWait } from "@shared/lib/process-stop";
import { describe, expect, it } from "vitest";
import * as acp from "@agentclientprotocol/sdk";

const runOpenCodeE2E = process.env.OPENCODE_E2E === "1";

describe.skipIf(!runOpenCodeE2E)("OpenCode ACP integration", () => {
  it("negotiates capabilities and creates a session", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "harnss-opencode-acp-"));
    const env = {
      ...process.env,
      HOME: path.join(dataDir, "home"),
      XDG_DATA_HOME: path.join(dataDir, "data"),
      XDG_CONFIG_HOME: path.join(dataDir, "config"),
      XDG_STATE_HOME: path.join(dataDir, "state"),
      XDG_CACHE_HOME: path.join(dataDir, "cache"),
    };
    const processHandle = spawnExecutable("opencode", ["acp", "--cwd", process.cwd()], {
      cwd: process.cwd(),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      const stdout = processHandle.stdout;
      if (!processHandle.stdin || !stdout) throw new Error("OpenCode process has no stdio streams");
      const output = new ReadableStream<Uint8Array>({
        start(controller) {
          stdout.on("data", (chunk: Buffer) => controller.enqueue(chunk));
          stdout.on("end", () => controller.close());
          stdout.on("error", (error) => controller.error(error));
        },
        cancel() { stdout.destroy(); },
      });
      const stream = acp.ndJsonStream(
        Writable.toWeb(processHandle.stdin),
        output,
      );
      const connection = new acp.ClientSideConnection(() => ({
        sessionUpdate: async () => {},
        requestPermission: async () => ({ outcome: { outcome: "cancelled" as const } }),
        readTextFile: async () => ({ content: "" }),
        writeTextFile: async () => ({}),
      }), stream);

      const initialized = await connection.initialize({
        protocolVersion: acp.PROTOCOL_VERSION,
        clientInfo: { name: "harnss-opencode-test", version: "0.22.0" },
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
      expect(initialized.agentInfo?.name).toBe("OpenCode");
      expect(initialized.agentCapabilities?.loadSession).toBe(true);

      const session = await connection.newSession({
        cwd: process.cwd(),
        mcpServers: [],
      });
      expect(session.sessionId).toMatch(/^ses_/);
      expect(session.configOptions?.some((option) => option.category === "model")).toBe(true);
      expect(session.configOptions?.some((option) => option.category === "mode")).toBe(true);
    } finally {
      await stopProcessAndWait(processHandle);
      await rm(dataDir, { recursive: true, force: true });
    }
  }, 30_000);
});
