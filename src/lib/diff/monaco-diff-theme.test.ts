import { describe, expect, it } from "vitest";
import { defineHarnssDiffThemes, harnssDiffThemeName } from "@/lib/diff/monaco-diff-theme";

describe("harnssDiffThemeName", () => {
  it("maps theme and colorblind flag to theme names", () => {
    expect(harnssDiffThemeName("light", false)).toBe("harnss-light");
    expect(harnssDiffThemeName("dark", false)).toBe("harnss-dark");
    expect(harnssDiffThemeName("light", true)).toBe("harnss-light-cb");
    expect(harnssDiffThemeName("dark", true)).toBe("harnss-dark-cb");
  });
});

describe("defineHarnssDiffThemes", () => {
  it("defines all four themes with diff color rules", () => {
    const defined: Array<{ name: string; base: string; colors: Record<string, string> }> = [];
    defineHarnssDiffThemes({
      editor: {
        defineTheme: (name, theme) => {
          defined.push({ name, base: theme.base, colors: theme.colors });
        },
      },
    });

    expect(defined.map((d) => d.name)).toEqual([
      "harnss-light",
      "harnss-dark",
      "harnss-light-cb",
      "harnss-dark-cb",
    ]);
    for (const entry of defined) {
      expect(entry.base).toBe(entry.name.includes("dark") ? "vs-dark" : "vs");
      expect(entry.colors["diffEditor.insertedLineBackground"]).toMatch(/^#[0-9a-f]{8}$/);
      expect(entry.colors["diffEditor.removedLineBackground"]).toMatch(/^#[0-9a-f]{8}$/);
    }

    // cb-safe themes must differ from the default red/green ones
    const light = defined.find((d) => d.name === "harnss-light")!;
    const lightCb = defined.find((d) => d.name === "harnss-light-cb")!;
    expect(lightCb.colors["diffEditor.insertedLineBackground"])
      .not.toBe(light.colors["diffEditor.insertedLineBackground"]);
  });
});
