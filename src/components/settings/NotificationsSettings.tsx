import { memo, useState, useCallback, useEffect } from "react";
import { Bell, Volume2, MonitorSmartphone, AudioWaveform } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import { useSettingsStore } from "@/stores/settings-store";
import type { AmbientSoundMode } from "@/lib/audio/ambient-player";
import type {
  NotificationTrigger,
  NotificationEventSettings,
  NotificationSettings,
  AppSettings,
} from "@/types";
import { useI18n, type TranslationKey } from "@/lib/i18n";

// ── Props ──

interface NotificationsSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Event type labels ──

const EVENT_GROUPS: Array<{
  key: keyof NotificationSettings;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
}> = [
  {
    key: "sessionComplete",
    labelKey: "settingsSessionComplete",
    descriptionKey: "settingsSessionCompleteDescription",
  },
  {
    key: "exitPlanMode",
    labelKey: "settingsExitPlanMode",
    descriptionKey: "settingsExitPlanModeDescription",
  },
  {
    key: "permissions",
    labelKey: "settingsPermissionRequest",
    descriptionKey: "settingsPermissionRequestDescription",
  },
  {
    key: "askUserQuestion",
    labelKey: "settingsAskUserQuestion",
    descriptionKey: "settingsAskUserQuestionDescription",
  },
];

const TRIGGER_OPTIONS: Array<{ value: NotificationTrigger; labelKey: TranslationKey }> = [
  { value: "always", labelKey: "settingsAlways" },
  { value: "unfocused", labelKey: "settingsWhenUnfocused" },
  { value: "never", labelKey: "settingsNever" },
];

// ── Component ──

export const NotificationsSettings = memo(function NotificationsSettings({
  appSettings,
  onUpdateAppSettings,
}: NotificationsSettingsProps) {
  const { t } = useI18n();
  const ambientSound = useSettingsStore((s) => s.ambientSound);
  const ambientVolume = useSettingsStore((s) => s.ambientVolume);
  const streamTickEnabled = useSettingsStore((s) => s.streamTickEnabled);
  const setAmbientSound = useSettingsStore((s) => s.setAmbientSound);
  const setAmbientVolume = useSettingsStore((s) => s.setAmbientVolume);
  const setStreamTickEnabled = useSettingsStore((s) => s.setStreamTickEnabled);
  const [settings, setSettings] = useState<NotificationSettings>({
    exitPlanMode: { osNotification: "unfocused", sound: "always" },
    permissions: { osNotification: "unfocused", sound: "unfocused" },
    askUserQuestion: { osNotification: "unfocused", sound: "always" },
    sessionComplete: { osNotification: "unfocused", sound: "always" },
  });

  // Sync from loaded AppSettings
  useEffect(() => {
    if (appSettings?.notifications) {
      setSettings(appSettings.notifications);
    }
  }, [appSettings]);

  const updateEventSetting = useCallback(
    async (
      eventKey: keyof NotificationSettings,
      field: keyof NotificationEventSettings,
      value: NotificationTrigger,
    ) => {
      const updated: NotificationSettings = {
        ...settings,
        [eventKey]: { ...settings[eventKey], [field]: value },
      };
      setSettings(updated); // optimistic
      await onUpdateAppSettings({ notifications: updated });
    },
    [settings, onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader
        title={t("notifications")}
        description={t("settingsNotificationsDescription")}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {EVENT_GROUPS.map((event, i) => (
            <SettingsSection key={event.key} icon={Bell} label={t(event.labelKey)} first={i === 0}>
              <p className="mb-2 text-xs text-muted-foreground">
                {t(event.descriptionKey)}
              </p>

              {/* Two setting rows per event: OS notification + sound */}
              <div className="flex flex-col">
                <SettingRow label={t("settingsOsNotification")}>
                  <div className="flex items-center gap-1.5">
                    <MonitorSmartphone className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[event.key].osNotification}
                      onValueChange={(v) =>
                        updateEventSetting(event.key, "osNotification", v)
                      }
                      options={TRIGGER_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    />
                  </div>
                </SettingRow>

                <SettingRow label={t("settingsSound")}>
                  <div className="flex items-center gap-1.5">
                    <Volume2 className="h-3.5 w-3.5 text-muted-foreground/50" />
                    <SettingsSelect
                      value={settings[event.key].sound}
                      onValueChange={(v) =>
                        updateEventSetting(event.key, "sound", v)
                      }
                      options={TRIGGER_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    />
                  </div>
                </SettingRow>
              </div>
            </SettingsSection>
          ))}

          {/* ── Ambient sound section ── */}
          <SettingsSection icon={AudioWaveform} label={t("settingsAmbientSound")}>
            <p className="mb-2 text-xs text-muted-foreground">
              {t("settingsAmbientSoundDescription")}
            </p>
            <div className="flex flex-col">
              <SettingRow label={t("settingsAmbientSoundMode")}>
                <SettingsSelect
                  value={ambientSound}
                  onValueChange={(v) => setAmbientSound(v as AmbientSoundMode)}
                  options={[
                    { value: "off", label: t("ambientOff") },
                    { value: "white", label: t("ambientWhite") },
                    { value: "pink", label: t("ambientPink") },
                    { value: "rain", label: t("ambientRain") },
                  ]}
                />
              </SettingRow>

              {ambientSound !== "off" && (
                <SettingRow label={t("settingsAmbientVolume")}>
                  <div className="flex w-40 items-center gap-2">
                    <Slider
                      min={0}
                      max={100}
                      step={1}
                      value={[Math.round(ambientVolume * 100)]}
                      onValueChange={([val]) => setAmbientVolume(val / 100)}
                    />
                    <span className="w-8 text-end text-xs tabular-nums text-muted-foreground">
                      {Math.round(ambientVolume * 100)}%
                    </span>
                  </div>
                </SettingRow>
              )}

              <SettingRow
                label={t("settingsStreamTick")}
                description={t("settingsStreamTickDescription")}
              >
                <Switch
                  checked={streamTickEnabled}
                  onCheckedChange={setStreamTickEnabled}
                />
              </SettingRow>
            </div>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
