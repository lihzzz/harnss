import { memo, useState, useCallback, useEffect } from "react";
import { MessageSquare, Code, Mic } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SettingRow, SettingsSelect, SettingsHeader, SettingsSection } from "@/components/settings/shared";
import type { AppSettings, PreferredEditor, VoiceDictationMode } from "@/types";

interface GeneralSettingsProps {
  appSettings: AppSettings | null;
  onUpdateAppSettings: (patch: Partial<AppSettings>) => Promise<void>;
}

// ── Component ──

export const GeneralSettings = memo(function GeneralSettings({
  appSettings,
  onUpdateAppSettings,
}: GeneralSettingsProps) {
  // Local optimistic state — synced from props once loaded
  const [chatLimit, setChatLimit] = useState(10);
  const [preferredEditor, setPreferredEditor] = useState<PreferredEditor>("auto");
  const [voiceDictation, setVoiceDictation] = useState<VoiceDictationMode>("native");

  useEffect(() => {
    if (appSettings) {
      setChatLimit(appSettings.defaultChatLimit || 10);
      setPreferredEditor(appSettings.preferredEditor || "auto");
      setVoiceDictation(appSettings.voiceDictation || "native");
    }
  }, [appSettings]);

  const handleChatLimitChange = useCallback(
    async (value: number) => {
      const clamped = Math.max(5, Math.min(100, value));
      setChatLimit(clamped);
      await onUpdateAppSettings({ defaultChatLimit: clamped });
    },
    [onUpdateAppSettings],
  );

  const handleEditorChange = useCallback(
    async (value: PreferredEditor) => {
      setPreferredEditor(value); // optimistic
      await onUpdateAppSettings({ preferredEditor: value });
    },
    [onUpdateAppSettings],
  );

  const handleVoiceDictationChange = useCallback(
    async (value: VoiceDictationMode) => {
      setVoiceDictation(value); // optimistic
      await onUpdateAppSettings({ voiceDictation: value });
    },
    [onUpdateAppSettings],
  );

  return (
    <div className="flex h-full flex-col">
      <SettingsHeader title="General" description="Application-wide preferences" />

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-2">
          {/* ── Sidebar section ── */}
          <SettingsSection icon={MessageSquare} label="Sidebar" first>
            <SettingRow
              label="Recent chats per project"
              description="Number of chats shown by default in each project. Click 'Show more' in the sidebar to load additional chats."
            >
              <SettingsSelect
                value={String(chatLimit)}
                onValueChange={(v) => handleChatLimitChange(Number(v))}
                options={[5, 10, 15, 20, 25, 30, 50, 100].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Editor section ── */}
          <SettingsSection icon={Code} label="Editor">
            <SettingRow
              label="Default editor"
              description="Choose which editor opens when you click 'Open in Editor'. Auto tries Cursor, VS Code, then Zed."
            >
              <SettingsSelect
                value={preferredEditor}
                onValueChange={handleEditorChange}
                options={[
                  { value: "auto", label: "Auto" },
                  { value: "cursor", label: "Cursor" },
                  { value: "code", label: "VS Code" },
                  { value: "zed", label: "Zed" },
                ]}
              />
            </SettingRow>
          </SettingsSection>

          {/* ── Voice Dictation section ── */}
          <SettingsSection icon={Mic} label="Voice Dictation">
            <SettingRow
              label="Dictation mode"
              description="Native uses your OS dictation (macOS only). Whisper runs a local AI model for speech-to-text on all platforms (~40 MB download on first use)."
            >
              <SettingsSelect
                value={voiceDictation}
                onValueChange={handleVoiceDictationChange}
                options={[
                  { value: "native", label: "Native (OS)" },
                  { value: "whisper", label: "Whisper (Local AI)" },
                ]}
              />
            </SettingRow>
          </SettingsSection>
        </div>
      </ScrollArea>
    </div>
  );
});
