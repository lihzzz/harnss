/**
 * Pure helpers shared between Electron and CLI Codex engine implementations.
 */

import type { CodexModel } from "../types/codex";
import type { CodexModelListResponse } from "../types/codex";
import type { ReasoningEffort } from "../types/codex-protocol/ReasoningEffort";

export const SUPPORTED_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
]);

export function isSupportedServerRequestMethod(method: string): boolean {
  return SUPPORTED_SERVER_REQUESTS.has(method);
}

/** Pick a valid model id from model/list, preferring the requested id when available. */
export function pickModelId(
  requestedModel: string | undefined,
  models: CodexModel[],
): string | undefined {
  const requested = typeof requestedModel === "string" ? requestedModel.trim() : "";
  if (requested.length > 0) {
    const hasRequested = models.some((m) => m.id === requested);
    if (hasRequested) return requested;
  }

  const defaultModel = models.find((m) => m.isDefault === true);
  if (defaultModel) return defaultModel.id;

  const first = models[0];
  return first?.id;
}

const VALID_REASONING_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

/**
 * model/list only returns the account model catalog; a custom-provider model
 * configured via config.toml (`model = "..."`) never appears in it. Merge the
 * configured model into the list so it stays selectable and can be passed
 * through to thread/start.
 */
export function mergeConfiguredModel(
  models: CodexModel[],
  configuredModel: unknown,
  configuredEffort?: unknown,
): CodexModel[] {
  if (typeof configuredModel !== "string") return models;
  const id = configuredModel.trim();
  if (!id || models.some((m) => m.id === id)) return models;
  const defaultReasoningEffort =
    typeof configuredEffort === "string" && VALID_REASONING_EFFORTS.has(configuredEffort)
      ? (configuredEffort as ReasoningEffort)
      : "medium";
  return [
    ...models,
    {
      id,
      model: id,
      upgrade: null,
      displayName: id,
      description: "Configured in ~/.codex/config.toml",
      hidden: false,
      supportedReasoningEfforts: (["low", "medium", "high"] as ReasoningEffort[]).map((effort) => ({
        reasoningEffort: effort,
        description: "",
      })),
      defaultReasoningEffort,
      inputModalities: ["text"],
      supportsPersonality: false,
      isDefault: false,
    },
  ];
}

interface ModelListRpc {
  request<T>(method: string, params?: unknown): Promise<T>;
}

/** model/list + config/read, with the config.toml model merged in when missing from the catalog. */
export async function listModelsWithConfigured(rpc: ModelListRpc): Promise<CodexModel[]> {
  const result = await rpc.request<CodexModelListResponse>("model/list", { includeHidden: false });
  const models = result.data ?? [];
  try {
    const configResult = await rpc.request<{
      config?: { model?: unknown; model_reasoning_effort?: unknown };
    }>("config/read");
    return mergeConfiguredModel(models, configResult.config?.model, configResult.config?.model_reasoning_effort);
  } catch {
    // config/read is best-effort — the catalog alone is a fine fallback.
    return models;
  }
}
