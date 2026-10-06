import type { MemoryGoldenCase, MemoryGoldenCaseScore, MemoryGoldenReport } from "@shared/types/memory";

/** Small, provider-independent regression set for the extraction prompt. */
export const MEMORY_GOLDEN_SET: MemoryGoldenCase[] = [
  {
    id: "preference",
    content: "I prefer concise answers and use dark mode for this project.",
    expectedKeywords: ["concise", "dark mode"],
    context: "User preference",
  },
  {
    id: "technical-fact",
    content: "The local API gateway listens on port 8787 and runs in the harnss repository.",
    expectedKeywords: ["8787", "API gateway", "harnss repository"],
    context: "Project fact",
  },
  {
    id: "experience",
    content: "I had a timeout while starting Hindsight, then retried successfully after the daemon became ready.",
    expectedKeywords: ["timeout", "Hindsight", "daemon"],
    context: "Troubleshooting experience",
  },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function scoreGoldenCase(testCase: MemoryGoldenCase, candidates: string[]): MemoryGoldenCaseScore {
  const expected = testCase.expectedKeywords.map(normalize).filter(Boolean);
  const normalizedCandidates = candidates.map(normalize).filter(Boolean);
  const matchedKeywords = expected.filter((keyword) => normalizedCandidates.some((candidate) => candidate.includes(keyword)));
  const relevantCandidates = normalizedCandidates.filter((candidate) => expected.some((keyword) => candidate.includes(keyword)));
  const precision = normalizedCandidates.length === 0 ? 0 : relevantCandidates.length / normalizedCandidates.length;
  const recall = expected.length === 0 ? 1 : matchedKeywords.length / expected.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { id: testCase.id, candidateCount: normalizedCandidates.length, matchedKeywords, precision, recall, f1 };
}

export function summarizeGoldenScores(scores: MemoryGoldenCaseScore[]): MemoryGoldenReport {
  const average = (key: "precision" | "recall" | "f1") => scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score[key], 0) / scores.length;
  return {
    cases: scores,
    precision: average("precision"),
    recall: average("recall"),
    f1: average("f1"),
    generatedAt: new Date().toISOString(),
  };
}

export async function runMemoryGoldenSet(bankId: string): Promise<MemoryGoldenReport | null> {
  const { dryRunExtractMemory } = await import("./client");
  const scores: MemoryGoldenCaseScore[] = [];
  for (const testCase of MEMORY_GOLDEN_SET) {
    const result = await dryRunExtractMemory(bankId, testCase.content, testCase.context);
    if (!result) return null;
    scores.push(scoreGoldenCase(testCase, (result.facts ?? []).map((fact) => fact.text)));
  }
  return summarizeGoldenScores(scores);
}
