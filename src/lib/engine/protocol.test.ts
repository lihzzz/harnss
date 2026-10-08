import { describe, expect, it } from "vitest";
import { extractToolResultImages, normalizeToolResult } from "@/lib/engine/protocol";

describe("computer-use MCP result normalization", () => {
  it("converts MCP image blocks to data URLs", () => {
    const images = extractToolResultImages([
      { type: "text", text: "Screenshot" },
      { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ]);

    expect(images).toEqual([
      { src: "data:image/png;base64,aGVsbG8=", mimeType: "image/png", alt: "Computer screenshot" },
    ]);
  });

  it("keeps images when a tool result already has structured fields", () => {
    const result = normalizeToolResult(
      { content: "Screenshot complete" },
      [{ type: "image", data: "AAAA", mimeType: "image/jpeg" }],
    );

    expect(result.content).toBe("Screenshot complete");
    expect(result.images?.[0]?.src).toBe("data:image/jpeg;base64,AAAA");
  });
});
