import { describe, expect, it } from "vitest";
import type { CodexThreadItem } from "@/types";
import { codexItemToToolResult, isComputerUseMcpCall } from "@/lib/engine/codex-adapter";

function mcpToolCallItem(overrides: {
  server: string;
  tool: string;
  result?: { content: Array<unknown>; structuredContent: unknown } | null;
}): CodexThreadItem {
  return {
    type: "mcpToolCall",
    id: "item-1",
    server: overrides.server,
    tool: overrides.tool,
    status: "completed",
    arguments: { code: "nodeRepl.write(hi)", title: "Say hi" },
    result: overrides.result ?? null,
    error: null,
  } as unknown as CodexThreadItem;
}

describe("isComputerUseMcpCall", () => {
  it("matches the Codex desktop computer-use MCP servers", () => {
    expect(isComputerUseMcpCall("node_repl", "js")).toBe(true);
    expect(isComputerUseMcpCall("cua_repl", "js")).toBe(true);
    expect(isComputerUseMcpCall("computer-use", "js")).toBe(true);
    expect(isComputerUseMcpCall("NODE_REPL", "js")).toBe(true);
  });

  it("rejects other servers and tools", () => {
    expect(isComputerUseMcpCall("node_repl", "js_reset")).toBe(false);
    expect(isComputerUseMcpCall("filesystem", "js")).toBe(false);
    expect(isComputerUseMcpCall("playwright", "browser_click")).toBe(false);
  });
});

describe("codexItemToToolResult computer use", () => {
  it("extracts text and screenshot blocks from a node_repl js result", () => {
    const item = mcpToolCallItem({
      server: "node_repl",
      tool: "js",
      result: {
        content: [
          { type: "text", text: "Finder window focused" },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
        structuredContent: { ok: true },
      },
    });

    const result = codexItemToToolResult(item);
    expect(result?.type).toBe("computer_use");
    expect(result?.content).toBe("Finder window focused");
    expect(result?.structuredContent).toEqual({ ok: true });
    expect(result?.images).toEqual([
      { src: "data:image/png;base64,aGVsbG8=", mimeType: "image/png", alt: "Computer screenshot" },
    ]);
  });

  it("supports image_url blocks and string content", () => {
    const item = mcpToolCallItem({
      server: "cua_repl",
      tool: "js",
      result: {
        content: [
          "plain text output",
          { type: "image_url", image_url: { url: "file:///tmp/shot.png" } },
        ],
        structuredContent: null,
      },
    });

    const result = codexItemToToolResult(item);
    expect(result?.type).toBe("computer_use");
    expect(result?.content).toBe("plain text output");
    expect(result?.images).toEqual([{ src: "file:///tmp/shot.png", alt: "Computer screenshot" }]);
    expect(result?.structuredContent).toBeUndefined();
  });

  it("omits the text content when a result only carries a screenshot", () => {
    const item = mcpToolCallItem({
      server: "node_repl",
      tool: "js",
      result: {
        content: [{ type: "image", data: "data:image/jpeg;base64,AAAA" }],
        structuredContent: null,
      },
    });

    const result = codexItemToToolResult(item);
    expect(result?.content).toBeUndefined();
    expect(result?.images?.[0]?.src).toBe("data:image/jpeg;base64,AAAA");
  });

  it("keeps the generic JSON handling for other MCP servers", () => {
    const item = mcpToolCallItem({
      server: "filesystem",
      tool: "read_file",
      result: {
        content: [{ type: "text", text: "file body" }],
        structuredContent: null,
      },
    });

    const result = codexItemToToolResult(item);
    expect(result?.type).toBeUndefined();
    expect(result?.images).toBeUndefined();
    expect(result?.content).toBe(JSON.stringify(item.type === "mcpToolCall" ? item.result : null));
  });
});
