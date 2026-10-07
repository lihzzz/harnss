import { describe, expect, it } from "vitest";
import { selectSessionRange } from "./useSessionSelection";

describe("stable session selection", () => {
  it("selects the visible range while retaining collapsed selections", () => {
    expect([...selectSessionRange(new Set(["collapsed"]), ["a", "b", "c"], "a", "c", true)]).toEqual(["collapsed", "a", "b", "c"]);
  });
  it("handles a hidden anchor as a single selection and toggles without Shift", () => {
    expect([...selectSessionRange(new Set(["hidden"]), ["b"], "hidden", "b", true)]).toEqual(["hidden", "b"]);
    expect([...selectSessionRange(new Set(["a"]), ["a"], null, "a", false)]).toEqual([]);
  });
  it("caps loaded-range selection at 500 targets", () => {
    const ids = Array.from({ length: 600 }, (_, i) => `id${i}`);
    expect(selectSessionRange(new Set(), ids, ids[0], ids[599], true).size).toBe(500);
  });
});
