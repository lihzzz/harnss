import { parentPort, workerData } from "node:worker_threads";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { HISTORY_EMBEDDING_MODEL as model } from "@shared/lib/embedding-model";
import { failure, isRecord, ProductivityError } from "../productivity-errors";
import { chunkHistoryText } from "./chunks";
import type { EmbeddingReply, EmbeddingRequest, EmbeddingValue } from "./embedding-protocol";

const port = parentPort;
if (!port || !isRecord(workerData) || typeof workerData.cacheDir !== "string") throw new Error("Invalid embedding worker startup");
const cacheDir = workerData.cacheDir;
const send = (message: EmbeddingReply) => port.postMessage(message);
let extractor: Promise<FeatureExtractionPipeline> | null = null;
async function load(): Promise<FeatureExtractionPipeline> {
  return extractor ??= (async () => {
    const { env, pipeline } = await import("@huggingface/transformers");
    env.cacheDir = cacheDir;
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    return pipeline("feature-extraction", model.id, {
      revision: model.revision, dtype: "q8", device: "cpu",
      session_options: { intraOpNumThreads: 1, interOpNumThreads: 1, enableCpuMemArena: false, enableMemPattern: false,
        graphOptimizationLevel: "basic", extra: { session: { disable_prepacking: "1" } } },
      progress_callback: (event) => {
        if (event.status === "progress") send({ type: "download", progress: { file: event.file, loaded: event.loaded, total: event.total || null } });
      },
    });
  })().catch((error: unknown) => { extractor = null; throw error; });
}

async function execute(request: EmbeddingRequest): Promise<EmbeddingValue> {
  const engine = await load();
  if (request.action === "chunks") return { chunks: chunkHistoryText(request.text, (text, special) => engine.tokenizer.encode(text, { add_special_tokens: special }).length) };
  const prefix = request.kind === "query" ? model.queryPrefix : model.passagePrefix;
  const texts = request.texts.map((text) => prefix + text);
  if (!texts.length || texts.length > 4) throw new ProductivityError("INVALID_ARGUMENT");
  for (const text of texts) if (engine.tokenizer.encode(text).length > model.maxTokens) throw new ProductivityError("QUERY_TOO_LONG", "This query exceeds the local model's 512-token input limit", false);
  const output = await engine(texts, { pooling: "mean", normalize: true });
  try {
    const data = output.data;
    if (!(data instanceof Float32Array) || output.dims[0] !== texts.length || output.dims[1] !== model.dimensions) throw new ProductivityError("MODEL_OUTPUT_INVALID");
    const vectors = texts.map((_, index) => data.slice(index * model.dimensions, (index + 1) * model.dimensions));
    if (!vectors.every((vector) => vector.every(Number.isFinite))) throw new ProductivityError("MODEL_OUTPUT_INVALID");
    return { vectors };
  } finally { output.dispose(); }
}

// A single client dispatches one batch at a time, keeping native inference bounded.
port.on("message", (request: EmbeddingRequest) => {
  void execute(request).then((value) => send({ type: "reply", id: request.id, result: { ok: true, value } }),
    (error: unknown) => send({ type: "reply", id: request.id, result: failure(error) }));
});
