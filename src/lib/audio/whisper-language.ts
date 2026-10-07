/** Select only language tokens; ordinary text logits must not influence detection. */
export function selectWhisperLanguage(logits: ArrayLike<number | bigint>, languageTokens: unknown): string {
  if (!languageTokens || typeof languageTokens !== "object") throw new Error("Speech model has no language map");
  let best: { language: string; score: number } | null = null;
  for (const [token, id] of Object.entries(languageTokens)) {
    const language = /^<\|([a-z]{2,3})\|>$/.exec(token)?.[1];
    if (!language || typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) continue;
    const score = logits[id];
    if (typeof score === "number" && Number.isFinite(score) && (!best || score > best.score)) best = { language, score };
  }
  if (!best) throw new Error("Speech language could not be detected");
  return best.language;
}
