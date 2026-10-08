import { describe, expect, it, vi } from "vitest";
import { SpeechRecorder, type SpeechRecording } from "./speech-recorder";
import type { SpeechSnapshot } from "@shared/types/speech";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
function setup() {
  let stopped: ((audio: Blob) => void) | undefined;
  const ready = deferred<void>();
  const transcript = deferred<string>();
  const state = { current: true };
  const changes: SpeechSnapshot[] = [];
  const insert = vi.fn(() => state.current);
  const orphan = vi.fn();
  const recording: SpeechRecording = { start: vi.fn((onStop) => { stopped = onStop; }), stop: vi.fn(() => stopped?.(new Blob(["audio"]))), release: vi.fn() };
  const dependencies = {
    permission: vi.fn(async () => true), prepare: vi.fn(async () => ready.promise),
    openMicrophone: vi.fn(async () => recording), transcribe: vi.fn(async () => transcript.promise),
    target: () => ({ isCurrent: () => state.current, insert }), changed: (next: SpeechSnapshot) => changes.push(next), orphan,
  };
  const recorder = new SpeechRecorder(dependencies);
  return { recorder, dependencies, changes, ready, transcript, state, insert, orphan, recording };
}

describe("SpeechRecorder", () => {
  it("does not open the microphone or claim to record until permissions and the model are ready", async () => {
    const { recorder, dependencies, ready, changes, recording } = setup();
    const start = recorder.start();
    await Promise.resolve();
    expect(recorder.phase).toBe("preparing");
    expect(dependencies.openMicrophone).not.toHaveBeenCalled();
    ready.resolve(); await start;
    expect(recording.start).toHaveBeenCalledOnce();
    expect(changes.map((entry) => entry.phase)).toEqual(["preparing", "recording"]);
  });
  it("does not activate a late microphone after the input target has changed", async () => {
    const { recorder, dependencies, ready, state } = setup();
    const start = recorder.start();
    await Promise.resolve();
    state.current = false;
    ready.resolve(); await start;
    expect(dependencies.openMicrophone).not.toHaveBeenCalled();
    expect(recorder.phase).toBe("idle");
  });
  it("releases a microphone that resolves after cancellation", async () => {
    const { recorder, dependencies, ready, recording } = setup();
    const opened = deferred<SpeechRecording>();
    dependencies.openMicrophone = vi.fn(() => opened.promise);
    ready.resolve();
    const start = recorder.start();
    await vi.waitFor(() => expect(dependencies.openMicrophone).toHaveBeenCalled());
    recorder.cancel(); opened.resolve(recording); await start;
    expect(recording.release).toHaveBeenCalled();
    expect(recording.start).not.toHaveBeenCalled();
  });
  it("stops recording on cancellation without sending audio for transcription", async () => {
    const { recorder, dependencies, ready, recording } = setup();
    ready.resolve(); await recorder.start();
    recorder.cancel();
    expect(recording.stop).toHaveBeenCalled();
    expect(recording.release).toHaveBeenCalled();
    expect(dependencies.transcribe).not.toHaveBeenCalled();
  });
  it("keeps a late transcript available to copy instead of inserting into a different conversation", async () => {
    const { recorder, ready, transcript, state, insert, orphan, recording } = setup();
    ready.resolve(); await recorder.start();
    recorder.stop(); expect(recording.release).toHaveBeenCalled();
    state.current = false; recorder.cancel(); transcript.resolve("前一条会话的转写");
    await vi.waitFor(() => expect(orphan).toHaveBeenCalledWith("前一条会话的转写"));
    expect(insert).not.toHaveBeenCalled();
  });
  it("inserts a completed transcript into its original target and returns to idle", async () => {
    const { recorder, ready, transcript, insert, orphan } = setup();
    ready.resolve(); await recorder.start(); recorder.stop();
    expect(recorder.phase).toBe("transcribing"); transcript.resolve("Hello 你好");
    await vi.waitFor(() => expect(recorder.phase).toBe("idle"));
    expect(insert).toHaveBeenCalledExactlyOnceWith("Hello 你好");
    expect(orphan).not.toHaveBeenCalled();
  });
  it("surfaces microphone denial and model failures without opening a stream", async () => {
    const { recorder, dependencies, ready } = setup();
    dependencies.permission.mockResolvedValue(false);
    await expect(recorder.start()).rejects.toThrow("Microphone access denied");
    expect(recorder.phase).toBe("error");
    dependencies.permission.mockResolvedValue(true);
    ready.reject(new Error("Download failed"));
    await expect(recorder.start()).rejects.toThrow("Download failed");
    expect(dependencies.openMicrophone).not.toHaveBeenCalled();
  });
});
