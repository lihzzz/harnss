import { describe, expect, it } from "vitest";
import type { CodexModel } from "@shared/types/codex";
import { listModelsWithConfigured, mergeConfiguredModel, pickModelId } from "@shared/lib/codex-helpers";

function catalogModel(id: string, isDefault = false): CodexModel {
  return {
    id,
    model: id,
    upgrade: null,
    displayName: id,
    description: "",
    hidden: false,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    inputModalities: ["text"],
    supportsPersonality: false,
    isDefault,
  };
}

describe("mergeConfiguredModel", () => {
  it("appends a configured model missing from the catalog", () => {
    const merged = mergeConfiguredModel([catalogModel("gpt-6.1-sol", true)], "Kimi-K3:glink_domestic", "high");
    expect(merged.map((m) => m.id)).toEqual(["gpt-6.1-sol", "Kimi-K3:glink_domestic"]);
    const added = merged[1];
    expect(added.defaultReasoningEffort).toBe("high");
    expect(added.isDefault).toBe(false);
    expect(added.supportedReasoningEfforts.map((e) => e.reasoningEffort)).toEqual(["low", "medium", "high"]);
  });

  it("does not duplicate a model already in the catalog", () => {
    const models = [catalogModel("gpt-6.1-sol", true)];
    expect(mergeConfiguredModel(models, "gpt-6.1-sol", undefined)).toBe(models);
  });

  it("ignores missing or blank configured models", () => {
    const models = [catalogModel("gpt-6.1-sol", true)];
    expect(mergeConfiguredModel(models, undefined, undefined)).toBe(models);
    expect(mergeConfiguredModel(models, "   ", undefined)).toBe(models);
    expect(mergeConfiguredModel(models, null, undefined)).toBe(models);
  });

  it("falls back to medium when the configured effort is not a valid effort", () => {
    const merged = mergeConfiguredModel([], "custom-model", "insane");
    expect(merged[0]?.defaultReasoningEffort).toBe("medium");
  });

  it("lets pickModelId accept the merged model", () => {
    const merged = mergeConfiguredModel([catalogModel("gpt-6.1-sol", true)], "Kimi-K3:glink_domestic", "high");
    expect(pickModelId("Kimi-K3:glink_domestic", merged)).toBe("Kimi-K3:glink_domestic");
  });
});

describe("listModelsWithConfigured", () => {
  function mockRpc(responses: Record<string, unknown>) {
    return {
      async request<T>(method: string): Promise<T> {
        const response = responses[method];
        if (response instanceof Error) throw response;
        return response as T;
      },
    };
  }

  it("merges the config.toml model into model/list results", async () => {
    const rpc = mockRpc({
      "model/list": { data: [catalogModel("gpt-6.1-sol", true)] },
      "config/read": { config: { model: "Kimi-K3:glink_domestic", model_reasoning_effort: "high" } },
    });
    const models = await listModelsWithConfigured(rpc);
    expect(models.map((m) => m.id)).toEqual(["gpt-6.1-sol", "Kimi-K3:glink_domestic"]);
  });

  it("returns the plain catalog when config/read fails", async () => {
    const rpc = mockRpc({
      "model/list": { data: [catalogModel("gpt-6.1-sol", true)] },
      "config/read": new Error("unsupported"),
    });
    const models = await listModelsWithConfigured(rpc);
    expect(models.map((m) => m.id)).toEqual(["gpt-6.1-sol"]);
  });
});
