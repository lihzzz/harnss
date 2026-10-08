/**
 * Monaco diff editor themes mirroring the CSS diff tokens in index.css
 * (--diff-add-bg / --diff-remove-bg, normal and .cb-safe variants).
 *
 * Monaco only accepts hex colors, so the palette is duplicated here as
 * pre-computed hex+alpha values. If you change the diff tokens in index.css,
 * update this file to match.
 */

export type HarnssDiffThemeName =
  | "harnss-light"
  | "harnss-dark"
  | "harnss-light-cb"
  | "harnss-dark-cb";

export function harnssDiffThemeName(resolvedTheme: "light" | "dark", colorblindSafe: boolean): HarnssDiffThemeName {
  if (resolvedTheme === "dark") return colorblindSafe ? "harnss-dark-cb" : "harnss-dark";
  return colorblindSafe ? "harnss-light-cb" : "harnss-light";
}

interface DiffThemeColors {
  insertedLine: string;
  insertedText: string;
  removedLine: string;
  removedText: string;
  insertedGutter: string;
  removedGutter: string;
}

const THEME_COLORS: Record<HarnssDiffThemeName, DiffThemeColors> = {
  // Mirrors index.css :root diff tokens (emerald/red, 10% line bg).
  "harnss-light": {
    insertedLine: "#10b9811a",
    insertedText: "#10b98130",
    removedLine: "#ef44441a",
    removedText: "#ef444430",
    insertedGutter: "#047857cc",
    removedGutter: "#b91c1ccc",
  },
  // Mirrors index.css .dark diff tokens (6% line bg).
  "harnss-dark": {
    insertedLine: "#10b9810f",
    insertedText: "#10b98126",
    removedLine: "#ef44440f",
    removedText: "#ef444426",
    insertedGutter: "#34d399cc",
    removedGutter: "#f87171cc",
  },
  // Mirrors index.css .cb-safe tokens (blue additions / orange removals).
  "harnss-light-cb": {
    insertedLine: "#3b82f61a",
    insertedText: "#3b82f630",
    removedLine: "#f9731620",
    removedText: "#f9731638",
    insertedGutter: "#1d4ed8cc",
    removedGutter: "#c2410ccc",
  },
  "harnss-dark-cb": {
    insertedLine: "#3b82f614",
    insertedText: "#3b82f62e",
    removedLine: "#f9731614",
    removedText: "#f973162e",
    insertedGutter: "#93c5fdcc",
    removedGutter: "#fdba74cc",
  },
};

interface MonacoThemeApi {
  editor: {
    defineTheme: (
      name: string,
      theme: {
        base: "vs" | "vs-dark";
        inherit: boolean;
        rules: never[];
        colors: Record<string, string>;
      },
    ) => void;
  };
}

/** Define all four Harnss diff themes. Safe to call multiple times. */
export function defineHarnssDiffThemes(monaco: MonacoThemeApi): void {
  for (const [name, colors] of Object.entries(THEME_COLORS) as [HarnssDiffThemeName, DiffThemeColors][]) {
    monaco.editor.defineTheme(name, {
      base: name.includes("dark") ? "vs-dark" : "vs",
      inherit: true,
      rules: [],
      colors: {
        "diffEditor.insertedLineBackground": colors.insertedLine,
        "diffEditor.insertedTextBackground": colors.insertedText,
        "diffEditor.removedLineBackground": colors.removedLine,
        "diffEditor.removedTextBackground": colors.removedText,
        "diffEditorOverview.insertedForeground": colors.insertedGutter,
        "diffEditorOverview.removedForeground": colors.removedGutter,
      },
    });
  }
}
