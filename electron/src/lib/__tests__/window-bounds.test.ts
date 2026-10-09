import { describe, expect, it } from "vitest";
import { fitWindowToWorkArea } from "../window-bounds";

describe("window work area bounds", () => {
  const requested = { x: 100, y: 100, width: 1548, height: 800 };
  const minimum = { width: 1548, height: 600 };
  it.each([
    ["1366 laptop", { x: 0, y: 0, width: 1366, height: 728 }],
    ["1920 display at 150%", { x: 0, y: 0, width: 1280, height: 680 }],
    ["small scaled work area", { x: 0, y: 0, width: 960, height: 500 }],
  ])("keeps the entire window reachable on %s", (_label, workArea) => {
    const fitted = fitWindowToWorkArea(requested, workArea, minimum);
    expect(fitted.bounds).toEqual(workArea);
    expect(fitted.minimumWidth).toBe(workArea.width);
    expect(fitted.minimumHeight).toBe(Math.min(workArea.height, minimum.height));
  });
  it("recovers offscreen windows after a display is removed", () => {
    const fitted = fitWindowToWorkArea({ ...requested, x: 3000, y: -1000 }, { x: -1440, y: 0, width: 1440, height: 900 }, minimum);
    expect(fitted.bounds).toEqual({ x: -1440, y: 0, width: 1440, height: 800 });
  });
  it("restores the preferred minimum on a larger screen and allows a lower renderer minimum", () => {
    const workArea = { x: 1920, y: 0, width: 2560, height: 1400 };
    expect(fitWindowToWorkArea({ ...requested, x: 1920, width: 1280 }, workArea, minimum).minimumWidth).toBe(1548);
    const fitted = fitWindowToWorkArea({ ...requested, x: 1920, width: 1100 }, workArea, { width: 1012, height: 600 });
    expect(fitted.minimumWidth).toBe(1012);
    expect(fitted.bounds.width).toBe(1100);
  });
  it("preserves reachable bounds on a normal macOS display", () => {
    const bounds = { x: 30, y: 50, width: 1200, height: 800 };
    expect(fitWindowToWorkArea(bounds, { x: 0, y: 25, width: 1728, height: 1050 }, { width: 996, height: 600 }).bounds).toEqual(bounds);
  });
});
