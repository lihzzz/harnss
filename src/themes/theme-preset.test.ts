import { describe, expect, it } from "vitest";
import {
  buildCustomThemeCss,
  validateThemePreset,
  CORE_THEME_TOKENS,
  type ThemeTokenSet,
} from "@/themes/theme-preset";

const LIGHT: ThemeTokenSet = {
  background: "oklch(0.98 0.01 90)",
  foreground: "oklch(0.25 0.02 60)",
  card: "#ffffff",
  "card-foreground": "oklch(0.25 0.02 60)",
  primary: "oklch(0.45 0.08 55)",
  "primary-foreground": "oklch(0.97 0.01 90)",
  border: "oklch(0.9 0.02 85)",
  "muted-foreground": "oklch(0.47 0.03 70)",
};

const DARK: ThemeTokenSet = {
  background: "oklch(0.22 0.015 70)",
  foreground: "oklch(0.93 0.01 85)",
  card: "oklch(0.28 0.015 70)",
  "card-foreground": "oklch(0.93 0.01 85)",
  primary: "oklch(0.85 0.05 80)",
  "primary-foreground": "oklch(0.22 0.015 70)",
  border: "oklch(0.38 0.02 75)",
  "muted-foreground": "oklch(0.72 0.02 80)",
};

function doc(overrides: Record<string, unknown> = {}): unknown {
  return { "harnss-theme": 1, name: "Test", light: LIGHT, dark: DARK, ...overrides };
}

describe("validateThemePreset", () => {
  it("accepts a valid theme document", () => {
    const result = validateThemePreset(doc());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.name).toBe("Test");
      expect(result.missingCore).toEqual([]);
    }
  });

  it("rejects wrong schema version", () => {
    expect(validateThemePreset(doc({ "harnss-theme": 2 })).ok).toBe(false);
    expect(validateThemePreset({}).ok).toBe(false);
    expect(validateThemePreset(null).ok).toBe(false);
  });

  it("rejects unknown token keys", () => {
    const bad = validateThemePreset(doc({ light: { ...LIGHT, "diff-add-fg": "red" } }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("diff-add-fg");
  });

  it("rejects invalid color values", () => {
    expect(validateThemePreset(doc({ light: { ...LIGHT, primary: "not-a-color" } })).ok).toBe(false);
    expect(validateThemePreset(doc({ light: { ...LIGHT, primary: 42 } })).ok).toBe(false);
  });

  it("rejects CSS injection attempts", () => {
    const evil = "oklch(0.5 0.1 200); } body { background: url(evil)";
    expect(validateThemePreset(doc({ light: { ...LIGHT, primary: evil } })).ok).toBe(false);
    const evil2 = "red}<script>";
    expect(validateThemePreset(doc({ light: { ...LIGHT, primary: evil2 } })).ok).toBe(false);
  });

  it("rejects token sets with fewer than 8 tokens", () => {
    const small = Object.fromEntries(Object.entries(LIGHT).slice(0, 5));
    expect(validateThemePreset(doc({ light: small })).ok).toBe(false);
  });

  it("flags missing core tokens without failing", () => {
    // Drop a core token but keep ≥8 tokens via a non-core one
    const { border: _b, ...noBorderLight } = LIGHT;
    const result = validateThemePreset(doc({ light: { ...noBorderLight, input: "oklch(0.9 0.02 85)" } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.missingCore).toEqual(["border"]);
    expect(CORE_THEME_TOKENS).toContain("background");
  });

  it("truncates overlong names", () => {
    const result = validateThemePreset(doc({ name: "x".repeat(100) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.preset.name.length).toBe(40);
  });
});

describe("buildCustomThemeCss", () => {
  it("generates scoped light/dark rules", () => {
    const css = buildCustomThemeCss({ id: "custom-1", name: "Test", light: LIGHT, dark: DARK });
    expect(css).toContain("html:not(.dark).theme-custom {");
    expect(css).toContain("html.dark.theme-custom {");
    expect(css).toContain("--primary: oklch(0.45 0.08 55);");
    expect(css).toContain("--background: oklch(0.22 0.015 70);");
  });
});
