import { describe, expect, it } from "vitest";
import { estimateRowHeight } from "@/lib/chat/virtualization";
import { DENSITY_FACTORS } from "@/hooks/useDensity";
import type { RowDescriptor } from "@/components/ChatView";

const PROCESSING: RowDescriptor = { kind: "processing" };
const SYSTEM_MESSAGE: RowDescriptor = {
  kind: "message",
  msg: { role: "system", isError: false } as never,
  originalIndex: 0,
};

describe("DENSITY_FACTORS", () => {
  it("maps compact/comfortable/loose to 0.85/1/1.15", () => {
    expect(DENSITY_FACTORS.compact).toBe(0.85);
    expect(DENSITY_FACTORS.comfortable).toBe(1);
    expect(DENSITY_FACTORS.loose).toBe(1.15);
  });
});

describe("estimateRowHeight density scaling", () => {
  it("defaults to factor 1 (comfortable)", () => {
    expect(estimateRowHeight(PROCESSING)).toBe(32);
    expect(estimateRowHeight(PROCESSING, 1)).toBe(32);
  });

  it("scales estimates by the density factor", () => {
    expect(estimateRowHeight(PROCESSING, 0.85)).toBe(Math.round(32 * 0.85));
    expect(estimateRowHeight(PROCESSING, 1.15)).toBe(Math.round(32 * 1.15));
    expect(estimateRowHeight(SYSTEM_MESSAGE, 0.85)).toBe(Math.round(36 * 0.85));
  });
});
