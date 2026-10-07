import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { VoiceDictationMode } from "@/types";
import type { SpeechSnapshot } from "@shared/types/speech";
import { openSpeechMicrophone, SpeechRecorder, type SpeechTarget } from "@/lib/audio/speech-recorder";
import { prepareWhisper, transcribeSpeech } from "@/lib/audio/whisper-client";
import { copyToClipboard } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";

let voiceOwner: SpeechRecorder | null = null;

export function useSpeechRecognition({ targetKey, captureTarget }: { targetKey: string; captureTarget: () => SpeechTarget | null }) {
  const { t } = useI18n();
  const [snapshot, setSnapshot] = useState<SpeechSnapshot>({ phase: "idle", progress: 0, error: null });
  const [platform, setPlatform] = useState<string | null>(null);
  const [mode, setMode] = useState<VoiceDictationMode>("native");
  const options = useRef({ captureTarget, t });
  options.current = { captureTarget, t };
  const mounted = useRef(false);
  const recorderRef = useRef<SpeechRecorder | null>(null);
  if (!recorderRef.current) recorderRef.current = new SpeechRecorder({
    permission: async () => (await window.claude.speech.requestMicPermission()).granted,
    prepare: prepareWhisper, openMicrophone: openSpeechMicrophone, transcribe: transcribeSpeech,
    target: () => options.current.captureTarget(),
    changed: (next) => { if (mounted.current) setSnapshot(next); },
    orphan: (text) => {
      const translate = options.current.t;
      toast(translate("Transcription from the previous conversation"), {
        description: text, duration: Infinity,
        action: { label: translate("Copy"), onClick: () => { void copyToClipboard(text).then((copied) => {
          if (copied) toast.success(translate("Transcription copied")); else toast.error(translate("Clipboard write failed"));
        }); } },
      });
    },
  });
  const recorder = recorderRef.current;
  useEffect(() => {
    mounted.current = true;
    window.claude.speech.getPlatform().then((value) => { if (mounted.current) setPlatform(value); }).catch((error: unknown) => {
      if (mounted.current) setSnapshot({ phase: "error", progress: 0, error: error instanceof Error ? error.message : String(error) });
    });
    window.claude.settings.get().then((settings) => { if (mounted.current && settings) setMode(settings.voiceDictation ?? "native"); });
    const unsubscribe = window.claude.settings.onChanged((settings) => setMode(settings.voiceDictation ?? "native"));
    const visibility = () => { if (document.hidden) recorder.cancel(); };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      mounted.current = false; recorder.cancel();
      if (voiceOwner === recorder) voiceOwner = null;
      unsubscribe(); document.removeEventListener("visibilitychange", visibility);
    };
  }, [recorder]);
  useEffect(() => () => { recorder.cancel(); }, [recorder, targetKey, mode]);
  const toggle = useCallback(async () => {
    if (mode === "whisper") {
      if (voiceOwner && voiceOwner !== recorder) voiceOwner.cancel();
      voiceOwner = recorder;
      await recorder.start();
      return;
    }
    if (!options.current.captureTarget()?.isCurrent()) throw new Error(options.current.t("The input is not ready"));
    const result = await window.claude.speech.startNativeDictation();
    if (!result.ok) throw new Error(options.current.t("Native dictation unavailable — enable Whisper in Settings"));
    toast(options.current.t("System dictation requested"));
  }, [mode, recorder]);
  const isAvailable = mode === "whisper" || platform === "darwin";
  return {
    phase: snapshot.phase, isListening: snapshot.phase === "recording", isTranscribing: snapshot.phase === "transcribing",
    isModelLoading: snapshot.phase === "preparing", loadProgress: snapshot.progress, error: snapshot.error,
    isAvailable, mode, toggle, cancel: () => recorder.cancel(),
    nativeHint: isAvailable ? null : t(platform === "win32" ? "Press Win + H for voice typing, or enable Whisper in Settings" : "Native dictation unavailable — enable Whisper in Settings"),
  };
}
