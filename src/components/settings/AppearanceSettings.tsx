import { memo, useRef } from "react";
import { SunMoon, Layout, Blend, Wrench, Palette, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { useSettingsStore, deriveMacBackgroundEffect } from "@/stores/settings-store";
import {
  BUILTIN_PRESETS,
  DEFAULT_THEME_ID,
  PRESET_PREVIEW_COLORS,
  validateThemePreset,
  type ThemePreset,
} from "@/themes/theme-preset";
import { isMac, isWindows } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/i18n";

const PRESET_NAME_KEYS: Record<string, TranslationKey> = {
  "warm-paper": "themePresetWarmPaper",
  midnight: "themePresetMidnight",
  tundra: "themePresetTundra",
};

function presetPreview(preset: ThemePreset): { background: string; primary: string; accent: string } {
  return PRESET_PREVIEW_COLORS[preset.id] ?? {
    background: preset.light.background ?? "oklch(1 0 0)",
    primary: preset.light.primary ?? "oklch(0.5 0.1 265)",
    accent: preset.light.accent ?? "oklch(0.95 0.01 265)",
  };
}

// ── Props ──

interface AppearanceSettingsProps {
  /** Whether the platform supports transparency (glass/mica) */
  glassSupported: boolean;
  macLiquidGlassSupported: boolean;
}

// ── Component ──

export const AppearanceSettings = memo(function AppearanceSettings({
  glassSupported,
  macLiquidGlassSupported,
}: AppearanceSettingsProps) {
  const { t } = useI18n();
  // ── Read all appearance settings from the Zustand store ──
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const themeAutoDayStart = useSettingsStore((s) => s.themeAutoDayStart);
  const themeAutoNightStart = useSettingsStore((s) => s.themeAutoNightStart);
  const setThemeAutoDayStart = useSettingsStore((s) => s.setThemeAutoDayStart);
  const setThemeAutoNightStart = useSettingsStore((s) => s.setThemeAutoNightStart);
  const density = useSettingsStore((s) => s.density);
  const setDensity = useSettingsStore((s) => s.setDensity);
  const motionLevel = useSettingsStore((s) => s.motionLevel);
  const setMotionLevel = useSettingsStore((s) => s.setMotionLevel);
  const colorblindSafe = useSettingsStore((s) => s.colorblindSafe);
  const setColorblindSafe = useSettingsStore((s) => s.setColorblindSafe);
  const activeThemeId = useSettingsStore((s) => s.activeThemeId);
  const customThemes = useSettingsStore((s) => s.customThemes);
  const setActiveThemeId = useSettingsStore((s) => s.setActiveThemeId);
  const addCustomTheme = useSettingsStore((s) => s.addCustomTheme);
  const removeCustomTheme = useSettingsStore((s) => s.removeCustomTheme);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const islandLayout = useSettingsStore((s) => s.islandLayout);
  const setIslandLayout = useSettingsStore((s) => s.setIslandLayout);
  const islandShine = useSettingsStore((s) => s.islandShine);
  const setIslandShine = useSettingsStore((s) => s.setIslandShine);
  const macBackgroundEffect = useSettingsStore((s) => deriveMacBackgroundEffect(s));
  const setMacBackgroundEffect = useSettingsStore((s) => s.setMacBackgroundEffect);
  const autoGroupTools = useSettingsStore((s) => s.autoGroupTools);
  const setAutoGroupTools = useSettingsStore((s) => s.setAutoGroupTools);
  const avoidGroupingEdits = useSettingsStore((s) => s.avoidGroupingEdits);
  const setAvoidGroupingEdits = useSettingsStore((s) => s.setAvoidGroupingEdits);
  const autoExpandTools = useSettingsStore((s) => s.autoExpandTools);
  const setAutoExpandTools = useSettingsStore((s) => s.setAutoExpandTools);
  const expandEditToolCallsByDefault = useSettingsStore((s) => s.expandEditToolCallsByDefault);
  const setExpandEditToolCallsByDefault = useSettingsStore((s) => s.setExpandEditToolCallsByDefault);
  const showToolIcons = useSettingsStore((s) => s.showToolIcons);
  const setShowToolIcons = useSettingsStore((s) => s.setShowToolIcons);
  const coloredToolIcons = useSettingsStore((s) => s.coloredToolIcons);
  const setColoredToolIcons = useSettingsStore((s) => s.setColoredToolIcons);
  const transparentToolPicker = useSettingsStore((s) => s.transparentToolPicker);
  const setTransparentToolPicker = useSettingsStore((s) => s.setTransparentToolPicker);
  const coloredSidebarIcons = useSettingsStore((s) => s.coloredSidebarIcons);
  const setColoredSidebarIcons = useSettingsStore((s) => s.setColoredSidebarIcons);
  const transparency = useSettingsStore((s) => s.transparency);
  const setTransparency = useSettingsStore((s) => s.setTransparency);

  const onThemeChange = setTheme;
  const onIslandLayoutChange = setIslandLayout;
  const onIslandShineChange = setIslandShine;
  const onMacBackgroundEffectChange = setMacBackgroundEffect;
  const onAutoGroupToolsChange = setAutoGroupTools;
  const onAvoidGroupingEditsChange = setAvoidGroupingEdits;
  const onAutoExpandToolsChange = setAutoExpandTools;
  const onExpandEditToolCallsByDefaultChange = setExpandEditToolCallsByDefault;
  const onShowToolIconsChange = setShowToolIcons;
  const onColoredToolIconsChange = setColoredToolIcons;
  const onTransparentToolPickerChange = setTransparentToolPicker;
  const onColoredSidebarIconsChange = setColoredSidebarIcons;
  const onTransparencyChange = setTransparency;

  const effectiveMacBackgroundEffect = !macLiquidGlassSupported && macBackgroundEffect === "liquid-glass"
    ? "vibrancy"
    : macBackgroundEffect;

  const hourOptions = Array.from({ length: 24 }, (_, hour) => ({
    value: String(hour),
    label: `${String(hour).padStart(2, "0")}:00`,
  }));

  // Keep the day/night boundaries distinct: changing one onto the other nudges
  // the other forward by one hour so the day window never degenerates.
  const onDayStartChange = (value: string) => {
    const hour = Number(value);
    if (hour === themeAutoNightStart) {
      setThemeAutoNightStart((hour + 1) % 24);
    }
    setThemeAutoDayStart(hour);
  };
  const onNightStartChange = (value: string) => {
    const hour = Number(value);
    if (hour === themeAutoDayStart) {
      setThemeAutoDayStart((hour + 1) % 24);
    }
    setThemeAutoNightStart(hour);
  };

  const onImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = validateThemePreset(parsed);
      if (!result.ok) {
        toast.error(`${t("themeImportFailed")}: ${result.error}`);
        return;
      }
      if (result.missingCore.length > 0) {
        console.warn(`[theme] imported theme is missing core tokens: ${result.missingCore.join(", ")}`);
      }
      const preset: ThemePreset = { ...result.preset, id: `custom-${Date.now()}` };
      addCustomTheme(preset);
      setActiveThemeId(preset.id);
      toast.success(t("themeImportSuccess"));
    } catch {
      toast.error(t("themeImportFailed"));
    }
  };

  const onExportTheme = () => {
    const active =
      customThemes.find((preset) => preset.id === activeThemeId)
      ?? BUILTIN_PRESETS.find((preset) => preset.id === activeThemeId);
    if (!active) return;
    const payload = { "harnss-theme": 1, name: active.name, light: active.light, dark: active.dark };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${active.name.replace(/[^\w-]+/g, "-")}.harnss-theme.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title={t("appearance")} description={t("settingsAppearanceDescription")} />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Theme section ── */}
          <SettingsSection icon={SunMoon} label={t("settingsTheme")} first>
            <SettingRow
              label={t("settingsColorTheme")}
              description={t("settingsColorThemeDescription")}
            >
              <SettingsSelect
                value={theme}
                onValueChange={onThemeChange}
                options={[
                  { value: "dark", label: t("dark") },
                  { value: "light", label: t("light") },
                  { value: "system", label: t("system") },
                  { value: "auto", label: t("themeAuto") },
                ]}
              />
            </SettingRow>

            {theme === "auto" && (
              <>
                <SettingRow
                  label={t("settingsThemeAutoDayStart")}
                  description={t("settingsThemeAutoDayStartDescription")}
                >
                  <SettingsSelect
                    value={String(themeAutoDayStart)}
                    onValueChange={onDayStartChange}
                    options={hourOptions}
                  />
                </SettingRow>
                <SettingRow
                  label={t("settingsThemeAutoNightStart")}
                  description={t("settingsThemeAutoNightStartDescription")}
                >
                  <SettingsSelect
                    value={String(themeAutoNightStart)}
                    onValueChange={onNightStartChange}
                    options={hourOptions}
                  />
                </SettingRow>
              </>
            )}

            <SettingRow
              label={t("settingsDensity")}
              description={t("settingsDensityDescription")}
            >
              <SettingsSelect
                value={density}
                onValueChange={setDensity}
                options={[
                  { value: "compact", label: t("densityCompact") },
                  { value: "comfortable", label: t("densityComfortable") },
                  { value: "loose", label: t("densityLoose") },
                ]}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsMotionLevel")}
              description={t("settingsMotionLevelDescription")}
            >
              <SettingsSelect
                value={motionLevel}
                onValueChange={setMotionLevel}
                options={[
                  { value: "auto", label: t("motionLevelAuto") },
                  { value: "full", label: t("motionLevelFull") },
                  { value: "reduced", label: t("motionLevelReduced") },
                ]}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsColorblindSafe")}
              description={t("settingsColorblindSafeDescription")}
            >
              <Switch
                checked={colorblindSafe}
                onCheckedChange={setColorblindSafe}
              />
            </SettingRow>

            <div className="py-3">
              <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                <Palette className="h-3.5 w-3.5 text-muted-foreground" />
                {t("settingsThemePresets")}
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{t("settingsThemePresetsDescription")}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {[
                  { id: DEFAULT_THEME_ID, name: t("themePresetDefault"), light: {}, dark: {} } as ThemePreset,
                  ...BUILTIN_PRESETS.map((p) => ({ ...p, name: t(PRESET_NAME_KEYS[p.id]) })),
                  ...customThemes,
                ].map((preset) => {
                  const preview = presetPreview(preset);
                  const isActive = activeThemeId === preset.id;
                  const isCustom = preset.id.startsWith("custom-");
                  return (
                    <div key={preset.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setActiveThemeId(preset.id)}
                        className={`w-full rounded-lg border p-2 text-start transition-colors ${
                          isActive
                            ? "border-primary bg-primary/[0.04]"
                            : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                        }`}
                      >
                        <div
                          className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-black/5"
                          style={{ background: preview.background }}
                        >
                          <span className="h-3 w-3 rounded-full" style={{ background: preview.primary }} />
                          <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: preview.accent }} />
                        </div>
                        <p className={`mt-1.5 text-center text-xs font-medium ${
                          isActive ? "text-primary" : "text-muted-foreground"
                        }`}>
                          {preset.name}
                        </p>
                      </button>
                      {isCustom && (
                        <button
                          type="button"
                          title={t("themeDeleteCustom")}
                          onClick={() => removeCustomTheme(preset.id)}
                          className="absolute -end-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-foreground/10 text-foreground/60 hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  {t("themeImport")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={onExportTheme}
                  disabled={activeThemeId === DEFAULT_THEME_ID}
                >
                  {t("themeExport")}
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={onImportFile}
              />
            </div>
          </SettingsSection>

          {/* ── Tools section ── */}
          <SettingsSection icon={Wrench} label={t("settingsTools")}>
            <SettingRow
              label={t("settingsAutoGroupTools")}
              description={t("settingsAutoGroupToolsDescription")}
            >
              <Switch
                checked={autoGroupTools}
                onCheckedChange={onAutoGroupToolsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsAvoidGroupingEdits")}
              description={t("settingsAvoidGroupingEditsDescription")}
            >
              <Switch
                checked={avoidGroupingEdits}
                onCheckedChange={onAvoidGroupingEditsChange}
                disabled={!autoGroupTools}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsAutoExpandTools")}
              description={t("settingsAutoExpandToolsDescription")}
            >
              <Switch
                checked={autoExpandTools}
                onCheckedChange={onAutoExpandToolsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsExpandEditTools")}
              description={t("settingsExpandEditToolsDescription")}
            >
              <Switch
                checked={expandEditToolCallsByDefault}
                onCheckedChange={onExpandEditToolCallsByDefaultChange}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsShowToolIcons")}
              description={t("settingsShowToolIconsDescription")}
            >
              <Switch
                checked={showToolIcons}
                onCheckedChange={onShowToolIconsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsColoredToolIcons")}
              description={t("settingsColoredToolIconsDescription")}
            >
              <Switch
                checked={coloredToolIcons}
                onCheckedChange={onColoredToolIconsChange}
                disabled={!showToolIcons}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Layout section ── */}
          <SettingsSection icon={Layout} label={t("settingsLayout")}>
            <div className="py-3">
              <p className="text-sm font-medium text-foreground">{t("settingsWindowLayout")}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("settingsWindowLayoutDescription")}
              </p>
              <div className="mt-3 flex gap-3">
                {/* ── Island preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(true)}
                >
                  {/* Mini app illustration — islands with gaps and rounded corners */}
                  <div className="flex h-[72px] gap-1 rounded-md bg-foreground/[0.04] p-1.5">
                    {/* Sidebar */}
                    <div className="w-[26%] rounded-[5px] bg-foreground/[0.07]" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      {/* Bottom bar hint */}
                      <div className="h-2.5 rounded-[4px] bg-foreground/[0.05]" />
                    </div>
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col gap-1">
                      <div className="flex-1 rounded-[5px] bg-foreground/[0.07]" />
                      <div className="h-[40%] rounded-[5px] bg-foreground/[0.07]" />
                    </div>
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {t("settingsIslands")}
                  </p>
                </button>

                {/* ── Flat preview ── */}
                <button
                  type="button"
                  className={`group flex-1 rounded-lg border-2 p-2.5 transition-colors ${
                    !islandLayout
                      ? "border-primary bg-primary/[0.04]"
                      : "border-transparent bg-foreground/[0.03] hover:bg-foreground/[0.05]"
                  }`}
                  onClick={() => onIslandLayoutChange(false)}
                >
                  {/* Mini app illustration — flat edge-to-edge with 1px dividers */}
                  <div className="flex h-[72px] overflow-hidden rounded-md bg-foreground/[0.04]">
                    {/* Sidebar */}
                    <div className="w-[26%] bg-foreground/[0.07]" />
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Chat */}
                    <div className="flex flex-1 flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-2.5 bg-foreground/[0.05]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool column */}
                    <div className="flex w-[22%] flex-col">
                      <div className="flex-1 bg-foreground/[0.07]" />
                      <div className="h-px bg-foreground/15" />
                      <div className="h-[40%] bg-foreground/[0.07]" />
                    </div>
                    {/* Divider */}
                    <div className="w-px bg-foreground/15" />
                    {/* Tool picker strip */}
                    <div className="flex w-2 flex-col items-center gap-1 bg-foreground/[0.04] pt-1.5">
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                      <div className="h-1.5 w-1.5 rounded-full bg-foreground/10" />
                    </div>
                  </div>
                  <p className={`mt-2 text-center text-xs font-medium ${
                    !islandLayout ? "text-primary" : "text-muted-foreground"
                  }`}>
                    {t("settingsFlat")}
                  </p>
                </button>
              </div>
            </div>

            <SettingRow
              label={t("settingsColoredSidebarIcons")}
              description={t("settingsColoredSidebarIconsDescription")}
            >
              <Switch
                checked={coloredSidebarIcons}
                onCheckedChange={onColoredSidebarIconsChange}
              />
            </SettingRow>

            <SettingRow
              label={t("settingsIslandShine")}
              description={t("settingsIslandShineDescription")}
            >
              <Switch
                checked={islandShine}
                onCheckedChange={onIslandShineChange}
                disabled={!islandLayout}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Transparency section ── */}
          <SettingsSection icon={Blend} label={t("settingsTransparency")}>
            <SettingRow
              label={t("settingsWindowBackgroundEffect")}
              description={
                !glassSupported
                  ? t("settingsWindowTransparencyUnavailable")
                  : isMac
                  ? (
                    macLiquidGlassSupported
                      ? t("settingsWindowBackgroundEffectDescription")
                      : t("settingsWindowBackgroundEffectUnavailable")
                  )
                  : (
                    isWindows
                    ? t("settingsWindowTransparencyDescription")
                    : t("settingsLinuxBackgroundEffectDescription")
                  )
              }
            >
              {isMac ? (
                <SettingsSelect
                  value={glassSupported ? effectiveMacBackgroundEffect : "off"}
                  onValueChange={onMacBackgroundEffectChange}
                  options={[
                    ...(macLiquidGlassSupported
                      ? [{ value: "liquid-glass" as const, label: "Liquid Glass" }]
                      : []),
                    { value: "vibrancy", label: "Vibrancy" },
                    { value: "off", label: "Blur Off" },
                  ]}
                  className="min-w-[9.5rem]"
                  disabled={!glassSupported}
                />
              ) : (
                <Switch
                  checked={glassSupported && transparency}
                  onCheckedChange={onTransparencyChange}
                  disabled={!glassSupported}
                />
              )}
            </SettingRow>

            <SettingRow
              label={t("settingsTransparentToolPicker")}
              description={t("settingsTransparentToolPickerDescription")}
            >
              <Switch
                checked={transparentToolPicker}
                onCheckedChange={onTransparentToolPickerChange}
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
