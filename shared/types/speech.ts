export type SpeechPhase = "idle" | "preparing" | "recording" | "transcribing" | "error";
export interface SpeechSnapshot { phase: SpeechPhase; progress: number; error: string | null }
export type WhisperRequest = { id: string; type: "prepare" } | { id: string; type: "transcribe"; audio: Float32Array };
export type WhisperResponse = { id: string; type: "progress"; progress: number } | { id: string; type: "ready" }
  | { id: string; type: "result"; text: string } | { id: string; type: "error"; message: string };

/** ONNX conversion of openai/whisper-tiny; multilingual transcription, never translation. */
export const WHISPER_MODEL = {
  id: "onnx-community/whisper-tiny",
  revision: "ff4177021cc41f7db950912b73ea4fdf7d01d8e7",
  dtype: "q8",
  weightBytes: { "onnx/encoder_model_quantized.onnx": 10124990, "onnx/decoder_model_merged_quantized.onnx": 30719241 },
} as const;
