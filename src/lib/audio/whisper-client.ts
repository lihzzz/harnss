import type { WhisperRequest, WhisperResponse } from "@shared/types/speech";

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const pending = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void; progress?: (percent: number) => void }>();

function scheduleUnload(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (pending.size) return;
  idleTimer = setTimeout(() => { worker?.terminate(); worker = null; }, 5 * 60_000);
}
function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WhisperResponse>) => {
    const response = event.data;
    const task = pending.get(response.id);
    if (!task) return;
    if (response.type === "progress") { task.progress?.(response.progress); return; }
    pending.delete(response.id);
    if (response.type === "error") task.reject(new Error(response.message));
    else task.resolve(response.type === "result" ? response.text : "");
    scheduleUnload();
  };
  worker.onerror = (event) => {
    for (const task of pending.values()) task.reject(new Error(event.message || "Speech worker stopped unexpectedly"));
    pending.clear(); worker?.terminate(); worker = null;
    scheduleUnload();
  };
  return worker;
}
function request(message: WhisperRequest, progress?: (percent: number) => void): Promise<string> {
  if (idleTimer) clearTimeout(idleTimer);
  return new Promise((resolve, reject) => {
    pending.set(message.id, { resolve, reject, progress });
    try { getWorker().postMessage(message, message.type === "transcribe" && message.audio.buffer instanceof ArrayBuffer ? [message.audio.buffer] : []); }
    catch (error) { pending.delete(message.id); reject(error); scheduleUnload(); }
  });
}
export async function prepareWhisper(progress: (percent: number) => void): Promise<void> {
  await request({ id: crypto.randomUUID(), type: "prepare" }, progress);
}
export async function transcribeSpeech(blob: Blob): Promise<string> {
  const audioContext = new AudioContext({ sampleRate: 16000 });
  let samples: Float32Array;
  try {
    const audio = await audioContext.decodeAudioData(await blob.arrayBuffer());
    samples = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const values = audio.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) samples[index] += values[index] / audio.numberOfChannels;
    }
  } finally { await audioContext.close(); }
  return request({ id: crypto.randomUUID(), type: "transcribe", audio: samples });
}
