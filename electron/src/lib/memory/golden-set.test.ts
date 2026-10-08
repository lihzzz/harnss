import { describe, expect, it } from "vitest";
import { MEMORY_GOLDEN_SET, scoreGoldenCase, summarizeGoldenScores } from "./golden-set";

describe("memory golden set evaluator", () => {
  it("keeps representative extraction cases with measurable expectations", () => {
    expect(MEMORY_GOLDEN_SET.length).toBeGreaterThanOrEqual(3);
    expect(MEMORY_GOLDEN_SET.every((testCase) => testCase.content.length > 20 && testCase.expectedKeywords.length > 0)).toBe(true);
  });

  it("scores keyword coverage and candidate precision", () => {
    const score = scoreGoldenCase(MEMORY_GOLDEN_SET[0], ["The user prefers concise answers.", "Dark mode is enabled."]);
    expect(score.precision).toBe(1);
    expect(score.recall).toBe(1);
    expect(score.f1).toBe(1);
  });

  it("summarizes case scores", () => {
    const report = summarizeGoldenScores([
      scoreGoldenCase(MEMORY_GOLDEN_SET[0], ["concise"]),
      scoreGoldenCase(MEMORY_GOLDEN_SET[1], []),
    ]);
    expect(report.cases).toHaveLength(2);
    expect(report.generatedAt).toMatch(/^20/);
  });
});
