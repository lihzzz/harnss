import { describe, expect, it } from "vitest";
import { pickCodexModel } from "./types";
import type { CodexModelSummary } from "./types";

function summary(id: string, isDefault = false): CodexModelSummary {
  return {
    id,
    displayName: id,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault,
  };
}

const MODELS = [summary("gpt-6.1-sol", true), summary("gpt-5.5")];

describe("pickCodexModel", () => {
  it("returns a requested catalog model", () => {
    expect(pickCodexModel("gpt-5.5", MODELS)).toBe("gpt-5.5");
  });

  it("falls back to the default model for unknown ids", () => {
    expect(pickCodexModel("retired-model", MODELS)).toBe("gpt-6.1-sol");
    expect(pickCodexModel(undefined, MODELS)).toBe("gpt-6.1-sol");
  });

  it("passes through the stored custom model id even when absent from the catalog", () => {
    expect(pickCodexModel("GLM-5.3", MODELS, "GLM-5.3")).toBe("GLM-5.3");
  });

  it("does not pass through arbitrary ids that merely resemble the custom model", () => {
    expect(pickCodexModel("glm-5.3", MODELS, "GLM-5.3")).toBe("gpt-6.1-sol");
    expect(pickCodexModel("GLM-5.3", MODELS, "")).toBe("gpt-6.1-sol");
  });

  it("passes through the custom model when the catalog is empty", () => {
    expect(pickCodexModel("GLM-5.3", [], "GLM-5.3")).toBe("GLM-5.3");
  });
});
