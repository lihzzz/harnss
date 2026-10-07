import { describe, expect, it } from "vitest";
import { resolveMotionLevel } from "@/lib/motion-level";

describe("resolveMotionLevel", () => {
  it("auto follows the OS preference", () => {
    expect(resolveMotionLevel("auto", true)).toBe("reduced");
    expect(resolveMotionLevel("auto", false)).toBe("full");
  });

  it("explicit levels override the OS preference", () => {
    expect(resolveMotionLevel("full", true)).toBe("full");
    expect(resolveMotionLevel("full", false)).toBe("full");
    expect(resolveMotionLevel("reduced", false)).toBe("reduced");
    expect(resolveMotionLevel("reduced", true)).toBe("reduced");
  });
});
