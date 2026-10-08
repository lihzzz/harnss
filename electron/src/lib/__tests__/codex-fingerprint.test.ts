import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFingerprintSamples, parseFingerprintNumbers } from "@shared/lib/codex-fingerprint";
import type { CodexFingerprintSample } from "@shared/types/codex-fingerprint";

const fixturePath = path.join(process.cwd(), "electron/src/lib/__tests__/fixtures/modeltrace-reference.jsonl");
const fixture = readFileSync(fixturePath, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line) as { model_id: string; requested_count: number; text: string });

function samplesFor(modelId: string): CodexFingerprintSample[] {
  return fixture
    .filter((row) => row.model_id === modelId)
    .map((row, index) => ({
      sampleId: index,
      threadId: `${modelId}-${index}`,
      requestedCount: row.requested_count,
      prompt: "test",
      response: row.text,
      parsedCount: parseFingerprintNumbers(row.text).length,
      accepted: true,
    }));
}

describe("codex fingerprint scoring", () => {
  it("keeps only the longest valid integer run", () => {
    expect(parseFingerprintNumbers("ignore 400 and 2, but 12 34 56 is valid")).toEqual([12, 34, 56]);
  });

  it("attributes ModelTrace reference outputs to their own model", () => {
    const modelId = fixture[0].model_id;
    const analysis = analyzeFingerprintSamples(samplesFor(modelId));

    expect(analysis?.prediction).toBe(modelId);
    expect(analysis?.usedOutputs).toBe(samplesFor(modelId).length);
  });
});
