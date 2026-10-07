import type { SpeechSnapshot } from "@shared/types/speech";

export interface SpeechTarget {
  isCurrent: () => boolean;
  insert: (text: string) => boolean;
}
export interface SpeechRecording {
  start: (onStop: (audio: Blob) => void, onError: (error: Error) => void) => void;
  stop: () => void;
  release: () => void;
}
interface SpeechRecorderDependencies {
  permission: () => Promise<boolean>;
  prepare: (progress: (value: number) => void) => Promise<void>;
  openMicrophone: () => Promise<SpeechRecording>;
  transcribe: (audio: Blob) => Promise<string>;
  target: () => SpeechTarget | null;
  changed: (snapshot: SpeechSnapshot) => void;
  orphan: (text: string) => void;
}

/** Capture owns an immutable target and generation across all asynchronous operations. */
export class SpeechRecorder {
  private epoch = 0;
  private recording: SpeechRecording | null = null;
  private snapshot: SpeechSnapshot = { phase: "idle", progress: 0, error: null };
  constructor(private readonly dependencies: SpeechRecorderDependencies) {}
  get phase(): SpeechSnapshot["phase"] { return this.snapshot.phase; }
  private publish(patch: Partial<SpeechSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.dependencies.changed(this.snapshot);
  }
  cancel(): void {
    this.epoch++;
    this.recording?.stop();
    this.recording?.release();
    this.recording = null;
    this.publish({ phase: "idle", progress: 0, error: null });
  }
  stop(): void {
    if (this.phase !== "recording") return;
    this.publish({ phase: "transcribing" });
    this.recording?.stop();
  }
  async start(): Promise<void> {
    if (this.phase === "preparing" || this.phase === "transcribing") throw new Error("Voice input is still preparing or transcribing");
    if (this.phase === "recording") { this.stop(); return; }
    const target = this.dependencies.target();
    if (!target?.isCurrent()) throw new Error("The input is not ready");
    const epoch = ++this.epoch;
    const current = () => this.epoch === epoch && target.isCurrent();
    this.publish({ phase: "preparing", progress: 0, error: null });
    try {
      if (!await this.dependencies.permission()) throw new Error("Microphone access denied");
      if (!current()) return;
      await this.dependencies.prepare((progress) => { if (current()) this.publish({ progress }); });
      if (!current()) return;
      const recording = await this.dependencies.openMicrophone();
      if (!current()) { recording.release(); return; }
      this.recording = recording;
      recording.start((audio) => {
        recording.release();
        if (this.recording === recording) this.recording = null;
        if (this.epoch !== epoch) return;
        if (!audio.size) { this.publish({ phase: "idle" }); return; }
        this.publish({ phase: "transcribing" });
        void this.dependencies.transcribe(audio).then((text) => {
          if (!text) return;
          if (this.epoch !== epoch || !target.insert(text)) this.dependencies.orphan(text);
        }).catch((error: unknown) => {
          if (this.epoch === epoch) this.publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
        }).finally(() => { if (this.epoch === epoch && this.phase !== "error") this.publish({ phase: "idle" }); });
      }, (error) => {
        recording.release();
        if (this.recording === recording) this.recording = null;
        if (this.epoch === epoch) this.publish({ phase: "error", error: error.message });
      });
      if (this.recording === recording && this.epoch === epoch) this.publish({ phase: "recording", progress: 100 });
    } catch (error) {
      if (this.epoch !== epoch) return;
      this.recording?.release(); this.recording = null;
      this.publish({ phase: "error", error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      if (this.epoch === epoch && this.snapshot.phase === "preparing" && !current()) this.publish({ phase: "idle" });
    }
  }
}

export async function openSpeechMicrophone(): Promise<SpeechRecording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => { for (const track of stream.getTracks()) track.stop(); };
  try {
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    return {
      start: (onStop, onError) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onstop = () => onStop(new Blob(chunks, { type: recorder.mimeType }));
        recorder.onerror = () => onError(new Error("Audio recording failed"));
        recorder.start();
      },
      stop: () => { if (recorder.state !== "inactive") recorder.stop(); },
      release,
    };
  } catch (error) { release(); throw error; }
}
