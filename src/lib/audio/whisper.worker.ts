import { pipeline, env, Tensor, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import wasmUrl from "@speech-runtime/ort-wasm-simd-threaded.jsep.wasm?url";
import moduleUrl from "@speech-runtime/ort-wasm-simd-threaded.jsep.mjs?url";
import { WHISPER_MODEL, type WhisperRequest, type WhisperResponse } from "@shared/types/speech";
import { selectWhisperLanguage } from "./whisper-language";

// Bundle the executable runtime. Only model files are fetched on first use.
env.allowLocalModels = false;
const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error("The speech WebAssembly runtime is unavailable");
wasm.wasmPaths = { wasm: wasmUrl, mjs: moduleUrl };
wasm.numThreads = 1;
let model: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
let queue = Promise.resolve();
const progressListeners = new Set<(progress: number) => void>();
const downloaded = new Map<string, number>();
const expectedWeights = new Map<string, number>(Object.entries(WHISPER_MODEL.weightBytes));
const totalBytes = [...expectedWeights.values()].reduce((total, bytes) => total + bytes, 0);
function send(response: WhisperResponse): void { self.postMessage(response); }
async function prepare(id: string): Promise<AutomaticSpeechRecognitionPipeline> {
  const onProgress = (progress: number) => send({ id, type: "progress", progress });
  progressListeners.add(onProgress);
  try {
    if (!model) model = pipeline("automatic-speech-recognition", WHISPER_MODEL.id, {
      revision: WHISPER_MODEL.revision, dtype: WHISPER_MODEL.dtype, device: "wasm",
      progress_callback: (progress) => {
        if (progress.status === "progress" || progress.status === "done") {
          const total = expectedWeights.get(progress.file);
          if (!total) return;
          downloaded.set(progress.file, progress.status === "done" ? total : Math.min(total, progress.loaded));
          const percent = Math.min(99, [...downloaded.values()].reduce((sum, bytes) => sum + bytes, 0) / totalBytes * 100);
          for (const listener of progressListeners) listener(percent);
        }
      },
    }).catch((error: unknown) => { model = null; downloaded.clear(); throw error; });
    return await model;
  } finally { progressListeners.delete(onProgress); }
}
async function handle(request: WhisperRequest): Promise<void> {
  try {
    const transcriber = await prepare(request.id);
    if (request.type === "prepare") { send({ id: request.id, type: "ready" }); return; }
    // Transformers.js 3.8.1 defaults to English rather than detecting a language.
    // Whisper's first decoder step, restricted to language tokens, supplies that choice.
    const features = await transcriber.processor(request.audio.subarray(0, 30 * 16000));
    const config: unknown = transcriber.model.generation_config;
    if (!config || typeof config !== "object" || !("decoder_start_token_id" in config)
      || typeof config.decoder_start_token_id !== "number" || !("lang_to_id" in config)) throw new Error("Invalid speech model configuration");
    const detected: unknown = await transcriber.model.forward({
      ...features, decoder_input_ids: new Tensor("int64", [BigInt(config.decoder_start_token_id)], [1, 1]),
    });
    if (!detected || typeof detected !== "object" || !("logits" in detected) || !(detected.logits instanceof Tensor)) throw new Error("Speech language detection failed");
    const language = selectWhisperLanguage(detected.logits.data, config.lang_to_id);
    const result = await transcriber(request.audio, { language, task: "transcribe", chunk_length_s: 30, stride_length_s: 5 });
    send({ id: request.id, type: "result", text: (Array.isArray(result) ? result.map((entry) => entry.text).join(" ") : result.text).trim() });
  } catch (error) { send({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) }); }
}
self.onmessage = (event: MessageEvent<WhisperRequest>) => {
  const request = event.data;
  // Model sessions must not be used by concurrent transcription calls.
  queue = queue.then(() => handle(request));
};
