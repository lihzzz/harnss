/** Same visible file/element context rules as the composer and message renderer. */
export function visibleHistoryText(content: string, displayContent: unknown): string {
  if (typeof displayContent === "string") return displayContent;
  return content
    .replace(/<file path="[^"]*">[\s\S]*?<\/file>\s*/g, "")
    .replace(/<folder path="[^"]*">[\s\S]*?<\/folder>\s*/g, "")
    .replace(/<element [^>]*>[\s\S]*?<\/element>\s*/g, "")
    .replace(/<harnss-memory>[\s\S]*?<\/harnss-memory>\s*/g, "")
    .trim();
}

export function normalizeHistoryText(text: string): string { return text.normalize("NFKC").toLowerCase(); }

/** Convert normalized matches back to UTF-16 offsets of the original text. */
export function historySnippet(text: string, query: string, maxLength = 300): { snippet: string; matchRanges: Array<{ start: number; end: number }> } {
  const needle = normalizeHistoryText(query);
  if (!needle) return { snippet: text.slice(0, maxLength), matchRanges: [] };
  const normalized = normalizeHistoryText(text);
  const match = normalized.indexOf(needle);
  if (match < 0) return { snippet: text.slice(0, maxLength), matchRanges: [] };
  // Only build the offset map for text that actually matched.
  const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
  let offset = 0;
  let start = 0;
  let end = text.length;
  for (const part of segments) {
    const next = offset + normalizeHistoryText(part.segment).length;
    if (offset <= match && next > match) start = part.index;
    if (next >= match + needle.length) { end = part.index + part.segment.length; break; }
    offset = next;
  }
  let snippetStart = Math.max(0, start - Math.floor(maxLength / 4));
  if (snippetStart > 0 && /[\uDC00-\uDFFF]/.test(text[snippetStart])) snippetStart--;
  let snippetEnd = Math.min(text.length, Math.max(end, snippetStart + maxLength));
  if (snippetEnd < text.length && /[\uDC00-\uDFFF]/.test(text[snippetEnd])) snippetEnd++;
  const prefix = snippetStart > 0 ? "…" : "";
  const suffix = snippetEnd < text.length ? "…" : "";
  return { snippet: prefix + text.slice(snippetStart, snippetEnd) + suffix, matchRanges: [{ start: start - snippetStart + prefix.length, end: end - snippetStart + prefix.length }] };
}
