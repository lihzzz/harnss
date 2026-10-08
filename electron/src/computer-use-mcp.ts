/**
 * Standalone MCP bridge for the Cua native SDK.
 *
 * Engine SDKs expect to launch an MCP server over stdio. Keeping this adapter
 * in a small Node child process avoids loading the native Cua bindings into
 * Electron's renderer and lets Claude, ACP, and Codex share the same tool
 * contract without requiring the external `cua-driver` executable.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

type CuaDriver = {
  callTool: (name: string, argumentsJson: string) => Promise<{
    text: string;
    images: Array<{ mimeType: string; dataBase64: string }>;
    structuredJson?: string;
    isError: boolean;
    rawJson: string;
  }>;
  listToolsJson: () => Promise<string>;
  metadata: () => Promise<{ driverVersion: string; contractVersion: string; embedded: boolean }>;
  shutdown: () => Promise<void>;
  uniffiDestroy?: () => void;
};

async function createDriver(): Promise<CuaDriver> {
  const cua = await import("@trycua/cua-driver");
  return cua.CuaDriver.create({ claudeCodeCompatibility: false }) as unknown as CuaDriver;
}

function parseTools(value: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(value) as { tools?: unknown };
  return Array.isArray(parsed.tools) ? parsed.tools as Array<Record<string, unknown>> : [];
}

function toMcpResult(result: Awaited<ReturnType<CuaDriver["callTool"]>>): Record<string, unknown> {
  const content: Array<Record<string, unknown>> = [];
  if (result.text) content.push({ type: "text", text: result.text });
  for (const image of result.images ?? []) {
    content.push({ type: "image", data: image.dataBase64, mimeType: image.mimeType });
  }

  let structuredContent: unknown;
  if (result.structuredJson) {
    try {
      structuredContent = JSON.parse(result.structuredJson);
    } catch {
      // Keep the canonical raw JSON in the text response when a platform
      // extension is not valid JSON for this adapter version.
    }
  }

  return {
    content,
    ...(structuredContent !== undefined ? { structuredContent } : {}),
    isError: result.isError,
  };
}

async function main(): Promise<void> {
  const driver = await createDriver();
  const tools = parseTools(await driver.listToolsJson());
  const server = new Server(
    { name: "harnss-cua", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await driver.callTool(
        request.params.name,
        JSON.stringify(request.params.arguments ?? {}),
      );
      return toMcpResult(result);
    } catch (error) {
      return {
        content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try { await server.close(); } catch { /* stdin may already be closed */ }
    try { await driver.shutdown(); } catch { /* native runtime is already stopping */ }
    try { driver.uniffiDestroy?.(); } catch { /* best-effort native cleanup */ }
  };
  transport.onclose = () => {
    if (!shuttingDown) void shutdown().finally(() => process.exit(0));
  };
  process.once("SIGTERM", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("SIGINT", () => { void shutdown().finally(() => process.exit(0)); });
  process.once("disconnect", () => { void shutdown().finally(() => process.exit(0)); });

  await server.connect(transport);
}

async function health(): Promise<void> {
  const driver = await createDriver();
  try {
    const metadata = await driver.metadata();
    process.stdout.write(JSON.stringify(metadata));
  } finally {
    await driver.shutdown();
    driver.uniffiDestroy?.();
  }
}

if (process.argv.includes("--health")) {
  health().then(() => process.exit(0)).catch((error) => {
    process.stderr.write(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
} else {
  main().catch((error) => {
    process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
