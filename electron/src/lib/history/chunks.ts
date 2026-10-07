import { HISTORY_EMBEDDING_MODEL as model } from "@shared/lib/embedding-model";

export interface HistoryChunk { index: number; start: number; end: number }
export type CountTokens = (text: string, specialTokens: boolean) => number;

function boundary(text: string, position: number): number {
  return position > 0 && /[\uDC00-\uDFFF]/.test(text[position] ?? "") ? position - 1 : position;
}

/** Exact source offsets; count the actual tokenizer output, including model prefixes. */
export function chunkHistoryText(text: string, count: CountTokens): HistoryChunk[] {
  if (!text.trim()) return [];
  const preferred: number[] = [];
  const fenced: Array<{ start: number; end: number }> = [];
  let fence: string | null = null;
  let fenceStart = 0;
  const lines = /.*(?:\n|$)/g;
  for (const line of text.matchAll(lines)) {
    if (!line[0]) continue;
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line[0])?.[1];
    if (marker && !fence) { preferred.push(line.index); fence = marker; fenceStart = line.index; }
    else if (marker && fence && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null; preferred.push(line.index + line[0].length); fenced.push({ start: fenceStart, end: line.index + line[0].length });
    }
    else if (!fence && !line[0].trim()) preferred.push(line.index + line[0].length);
  }
  preferred.push(text.length);
  const chunks: HistoryChunk[] = [];
  let start = 0;
  while (start < text.length) {
    // Bound each tokenization even for megabyte messages. This is a character
    // ceiling, not a token estimate; every accepted slice is token-counted below.
    let low = start + 1, high = Math.min(text.length, start + 8192), end = start;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = boundary(text, middle);
      if (count(model.passagePrefix + text.slice(start, candidate), true) <= model.chunkTokens) { end = candidate; low = middle + 1; }
      else high = middle - 1;
    }
    if (end <= start) throw new Error("The embedding tokenizer cannot encode this text within its input limit");
    const paragraphEnd = preferred.findLast((position) => position > start && position <= end);
    if (paragraphEnd && paragraphEnd > start + (end - start) / 2) end = paragraphEnd;
    const nextCode = fenced.find((block) => block.start > start && block.start < end && block.end > end
      && count(model.passagePrefix + text.slice(block.start, block.end), true) <= model.chunkTokens);
    if (nextCode) end = nextCode.start;
    chunks.push({ index: chunks.length, start, end });
    if (end === text.length) break;
    // Find an overlap of at most 64 body tokens without splitting a surrogate pair.
    low = start + 1; high = end;
    let next = end;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = boundary(text, middle);
      if (candidate > start && count(text.slice(candidate, end), false) <= model.overlapTokens) { next = candidate; high = middle - 1; }
      else low = middle + 1;
    }
    // A complete code block takes precedence over overlap when both cannot fit.
    start = nextCode && count(model.passagePrefix + text.slice(next, nextCode.end), true) > model.chunkTokens ? end : next;
  }
  return chunks;
}
