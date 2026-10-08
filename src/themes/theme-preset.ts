/**
 * Theme preset system.
 *
 * A preset overrides a whitelist of CSS color tokens (see index.css) for both
 * light and dark modes. Built-in presets ship as CSS classes in presets.css;
 * imported custom presets are applied via a generated <style> tag by
 * useThemePreset. Diff tokens (--diff-*) and layout variables are excluded on
 * purpose so presets cannot break the colorblind-safe palette or layout.
 */

/** Token keys (without the `--` prefix) a preset may override. */
export const THEME_TOKEN_KEYS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "ring",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];

const THEME_TOKEN_KEY_SET: ReadonlySet<string> = new Set(THEME_TOKEN_KEYS);

/** Core tokens every preset should define; missing ones fall back to the
 *  default theme via the CSS cascade (with a console warning). */
export const CORE_THEME_TOKENS: ThemeTokenKey[] = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "primary",
  "primary-foreground",
  "border",
  "muted-foreground",
];

export type ThemeTokenSet = Partial<Record<ThemeTokenKey, string>>;

export interface ThemePreset {
  id: string;
  name: string;
  light: ThemeTokenSet;
  dark: ThemeTokenSet;
}

export const DEFAULT_THEME_ID = "default";

/** Built-in presets. Token values live in presets.css (classes theme-{id}). */
export const BUILTIN_PRESETS: ThemePreset[] = [
  { id: "warm-paper", name: "Warm Paper", light: {}, dark: {} },
  { id: "midnight", name: "Midnight", light: {}, dark: {} },
  { id: "tundra", name: "Tundra", light: {}, dark: {} },
];

/** Preview swatch colors for builtin presets + the default theme.
 *  Mirror the light-mode tokens in presets.css / index.css — keep in sync. */
export const PRESET_PREVIEW_COLORS: Record<string, { background: string; primary: string; accent: string }> = {
  [DEFAULT_THEME_ID]: {
    background: "oklch(1 0 0)",
    primary: "oklch(0.15 0.006 285.885)",
    accent: "oklch(0.976 0.001 286.029)",
  },
  "warm-paper": {
    background: "oklch(0.975 0.012 90)",
    primary: "oklch(0.45 0.08 55)",
    accent: "oklch(0.93 0.02 85)",
  },
  midnight: {
    background: "oklch(0.985 0.005 250)",
    primary: "oklch(0.45 0.15 265)",
    accent: "oklch(0.94 0.015 255)",
  },
  tundra: {
    background: "oklch(0.98 0.008 150)",
    primary: "oklch(0.45 0.09 165)",
    accent: "oklch(0.94 0.015 150)",
  },
};

// ── Validation ──

export const THEME_SCHEMA_VERSION = 1;
const MAX_THEME_NAME_LENGTH = 40;
const MIN_TOKEN_COUNT = 8;
/** Characters that could break out of a CSS declaration in the injected <style>. */
const UNSAFE_COLOR_CHARS = /[{};<>\\]/;
const COLOR_SHAPE_RE = /^(#[0-9a-f]{3,8}|(oklch|oklab|hsl|hsla|rgb|rgba|lab|lch|color)\([^)]+\))$/i;

function defaultIsValidColor(value: string): boolean {
  if (UNSAFE_COLOR_CHARS.test(value)) return false;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    return CSS.supports("color", value);
  }
  return COLOR_SHAPE_RE.test(value);
}

export type ThemeValidation =
  | { ok: true; preset: Omit<ThemePreset, "id">; missingCore: ThemeTokenKey[] }
  | { ok: false; error: string };

function validateTokenSet(
  value: unknown,
  label: string,
  isValidColor: (v: string) => boolean,
): { ok: true; tokens: ThemeTokenSet } | { ok: false; error: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: `${label} must be an object` };
  }
  const tokens: ThemeTokenSet = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!THEME_TOKEN_KEY_SET.has(key)) {
      return { ok: false, error: `${label}: unknown token "${key}"` };
    }
    if (typeof raw !== "string" || !isValidColor(raw)) {
      return { ok: false, error: `${label}: invalid color for token "${key}"` };
    }
    tokens[key as ThemeTokenKey] = raw;
  }
  return { ok: true, tokens };
}

/**
 * Validate an imported theme JSON document.
 * Expected shape: { "harnss-theme": 1, name, light: TokenSet, dark: TokenSet }.
 */
export function validateThemePreset(
  data: unknown,
  isValidColor: (v: string) => boolean = defaultIsValidColor,
): ThemeValidation {
  if (typeof data !== "object" || data === null) {
    return { ok: false, error: "not an object" };
  }
  const doc = data as Record<string, unknown>;
  if (doc["harnss-theme"] !== THEME_SCHEMA_VERSION) {
    return { ok: false, error: `expected "harnss-theme": ${THEME_SCHEMA_VERSION}` };
  }
  if (typeof doc.name !== "string" || doc.name.trim().length === 0) {
    return { ok: false, error: "name is required" };
  }
  const name = doc.name.trim().slice(0, MAX_THEME_NAME_LENGTH);

  const light = validateTokenSet(doc.light, "light", isValidColor);
  if (!light.ok) return light;
  const dark = validateTokenSet(doc.dark, "dark", isValidColor);
  if (!dark.ok) return dark;

  for (const [label, tokens] of [["light", light.tokens], ["dark", dark.tokens]] as const) {
    const count = Object.keys(tokens).length;
    if (count < MIN_TOKEN_COUNT) {
      return { ok: false, error: `${label}: needs at least ${MIN_TOKEN_COUNT} tokens, got ${count}` };
    }
  }

  const missingCore = CORE_THEME_TOKENS.filter(
    (key) => !(key in light.tokens) || !(key in dark.tokens),
  );
  return { ok: true, preset: { name, light: light.tokens, dark: dark.tokens }, missingCore };
}

// ── CSS generation ──

function tokenSetToCssRules(tokens: ThemeTokenSet): string {
  return Object.entries(tokens)
    .map(([key, value]) => `  --${key}: ${value};`)
    .join("\n");
}

/** Build the <style> contents for an active custom theme preset. */
export function buildCustomThemeCss(preset: ThemePreset): string {
  return [
    "html:not(.dark).theme-custom {",
    tokenSetToCssRules(preset.light),
    "}",
    "html.dark.theme-custom {",
    tokenSetToCssRules(preset.dark),
    "}",
    "",
  ].join("\n");
}
