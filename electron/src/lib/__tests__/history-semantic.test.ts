import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HISTORY_EMBEDDING_MODEL as model } from "@shared/lib/embedding-model";
import type { HistorySearchRequest } from "@shared/types/productivity";
import { chunkHistoryText } from "../history/chunks";
import { EmbeddingClient } from "../history/embedding-client";
import { HistorySqlite } from "../history/sqlite";
import { HistoryStore } from "../history/store";
import { extractHistoryConversation } from "../history/source";
import { searchHistory, type HistoryQueryContext } from "../history/query";
import { emptyCoverage, type HistorySnapshot } from "../history/types";
import type { SemanticMatch } from "../history/semantic";

const count = (text: string, special: boolean) => [...text].length + (special ? 2 : 0);
const vector = () => { const value = new Float32Array(model.dimensions); value[0] = 1; return value; };
const signal = () => new AbortController().signal;
const catalog = { projects: [{ id: "p", name: "Project", spaceId: "space" }], spaces: [{ id: "space", name: "Space" }] };
const request: HistorySearchRequest = { requestId: "semantic", scope: { kind: "all" }, engines: [], includeArchived: true,
  query: "防止删除的会话复活", mode: "semantic", sort: "relevance", from: null, to: null, limit: 30, cursor: null };
const source = () => ({ id: "r", projectId: "p", conversationId: "conversation", title: "History", engine: "claude", createdAt: 1,
  messages: [{ id: "body", role: "user", content: "持久化删除屏障会拒绝迟到的写入任务。", timestamp: 100 }] });
function snapshot(data = source()): HistorySnapshot {
  const conversation = extractHistoryConversation(data, "p", "r", 1);
  return { conversations: new Map([[conversation.conversationKey, conversation]]), coverage: { ...emptyCoverage(), indexed: 1, discovered: 1, keywordComplete: true }, warnings: [], signature: "test" };
}
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-semantic-test-")); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
async function write(data = source()) { await fs.mkdir(path.join(root, "sessions/p"), { recursive: true }); await fs.writeFile(path.join(root, "sessions/p/r.json"), JSON.stringify(data)); }
function fakeEncoder() {
  return vi.spyOn(EmbeddingClient.prototype, "call").mockImplementation(async (command) => command.action === "chunks"
    ? { chunks: chunkHistoryText(command.text, count) } : { vectors: command.texts.map(vector) });
}

describe("source-preserving semantic chunks", () => {
  it("covers long multilingual text with bounded tokens, overlap and intact Unicode offsets", () => {
    const text = "中文😀e\u0301 ".repeat(200);
    const chunks = chunkHistoryText(text, count);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks[0].start).toBe(0); expect(chunks.at(-1)?.end).toBe(text.length);
    for (const [index, chunk] of chunks.entries()) {
      const value = text.slice(chunk.start, chunk.end);
      expect(value).not.toMatch(/[\uD800-\uDFFF]/u);
      expect(count(model.passagePrefix + value, true)).toBeLessThanOrEqual(model.chunkTokens);
      if (index) {
        const previous = chunks[index - 1];
        expect(chunk.start).toBeGreaterThan(previous.start);
        expect(chunk.start).toBeLessThan(previous.end);
        expect(count(text.slice(chunk.start, previous.end), false)).toBeLessThanOrEqual(model.overlapTokens);
      }
    }
  });
  it("keeps a fitting fenced block together and never indexes blank-only text", () => {
    const block = "```ts\n" + "const result = 1;\n".repeat(18) + "```\n";
    const text = "introduction ".repeat(20) + "\n\n" + block + "\nConclusion.";
    expect(chunkHistoryText(text, count).some((chunk) => text.slice(chunk.start, chunk.end).includes(block))).toBe(true);
    expect(chunkHistoryText(" \n\t", count)).toEqual([]);
  });
});

describe("semantic cache consistency", () => {
  it("retains embeddings across archive/runtime changes and excludes revisions before re-embedding", async () => {
    const db = new HistorySqlite(path.join(root, "history.sqlite"));
    try {
      let data = source(), state = snapshot(data);
      const conversation = [...state.conversations.values()][0], entry = conversation.entries[1];
      await db.sync(state, 1, signal());
      expect(db.saveEmbeddings(entry.entryKey, entry.contentHash, model.key, [{ index: 0, start: 0, end: entry.displayText.length, contentHash: entry.contentHash, vector: vector() }])).toBe(true);
      data = { ...data, id: "r", title: "Renamed" };
      state = snapshot(data); const updated = [...state.conversations.values()][0]; updated.runtimeSessionId = "revived"; updated.archived = true; updated.sourceRevision += "changed";
      await db.sync(state, 2, signal());
      expect(db.hasEmbedding(entry.entryKey, entry.contentHash, model.key)).toBe(true);
      expect([...db.vectors(["p"], { ...request, includeArchived: false }, model.key)]).toHaveLength(0);
      expect([...db.vectors(["p"], request, model.key)]).toHaveLength(1);
      state = snapshot({ ...data, messages: [{ ...data.messages[0], content: "修订后的不同内容" }] });
      await db.sync(state, 3, signal());
      expect([...db.vectors(["p"], request, model.key)]).toHaveLength(0);
      expect(db.saveEmbeddings(entry.entryKey, entry.contentHash, model.key, [])).toBe(false);
      await db.sync({ ...state, conversations: new Map() }, 4, signal());
      expect(db.cachedVector(entry.contentHash, model.key, model.dimensions)).toBeNull();
    } finally { db.close(); }
  });
  it("copies only still-current vectors into a rebuilt keyword index", async () => {
    const old = new HistorySqlite(path.join(root, "old.sqlite")), rebuilt = new HistorySqlite(path.join(root, "new.sqlite"));
    try {
      const state = snapshot(), entry = [...state.conversations.values()][0].entries[1];
      await old.sync(state, 1, signal()); await rebuilt.sync(state, 2, signal());
      old.saveEmbeddings(entry.entryKey, entry.contentHash, model.key, [{ index: 0, start: 0, end: entry.displayText.length, contentHash: entry.contentHash, vector: vector() }]);
      rebuilt.copySemanticFrom(old);
      expect(rebuilt.hasEmbedding(entry.entryKey, entry.contentHash, model.key)).toBe(true);
      expect(rebuilt.cachedVector(entry.contentHash, model.key, model.dimensions)).toEqual(vector());
    } finally { old.close(); rebuilt.close(); }
  });
  it("reuses encoded messages after metadata-only source saves", async () => {
    const encoder = fakeEncoder(); await write();
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready(); store.configureSemantic(true, model.key);
      await vi.waitFor(() => expect(store.status().coverage.semanticComplete).toBe(true));
      const calls = encoder.mock.calls.length;
      const data = source(); await write({ ...data, createdAt: 2 }); store.invalidate(); await store.refresh();
      await vi.waitFor(() => expect(store.status().coverage.semanticComplete).toBe(true));
      expect(encoder.mock.calls).toHaveLength(calls);
    } finally { await store.close(); }
  });
  it("cannot reinsert vectors when a deletion wins during embedding", async () => {
    await write(); let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const encoder = fakeEncoder();
    encoder.mockImplementation(async (command) => {
      if (command.action === "chunks") return { chunks: chunkHistoryText(command.text, count) };
      await gate; return { vectors: command.texts.map(vector) };
    });
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready(); store.configureSemantic(true, model.key);
      await vi.waitFor(() => expect(encoder.mock.calls.some(([command]) => command.action === "embed")).toBe(true));
      const key = [...store.context().snapshot.conversations.keys()][0];
      store.sourceChanged(key, true); await fs.unlink(path.join(root, "sessions/p/r.json")); await store.refresh();
      finish?.();
      await vi.waitFor(() => expect(store.status().semanticState).toBe("ready"));
      expect(store.context().snapshot.conversations.size).toBe(0);
      const db = new HistorySqlite(path.join(root, "history/index-v1.sqlite"));
      try { expect([...db.vectors(["p"], request, model.key)]).toHaveLength(0); } finally { db.close(); }
    } finally { finish?.(); await store.close(); }
  });
  it("holds a consistent vector snapshot while yielding and releases writers afterward", async () => {
    fakeEncoder(); await write();
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    let release: (() => void) | undefined;
    try {
      await store.ready(); store.configureSemantic(true, model.key);
      await vi.waitFor(() => expect(store.status().coverage.semanticComplete).toBe(true));
      const result = await store.semanticSearch(request, signal()); release = result.release;
      expect(result.matches.length).toBeGreaterThan(0);
      let refreshed = false;
      const refresh = store.refresh(true).then(() => { refreshed = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(refreshed).toBe(false);
      release(); await refresh;
      expect(refreshed).toBe(true);
    } finally { release?.(); await store.close(); }
  });
});

describe("semantic and hybrid retrieval contracts", () => {
  it("uses source chunks for semantic snippets and fuses entry ranks without duplicate messages", async () => {
    const data = source(); data.messages[0].content = "irrelevant preface ".repeat(50) + "持久化删除屏障";
    const state = snapshot(data), entry = [...state.conversations.values()][0].entries[1];
    const context: HistoryQueryContext = { snapshot: state, catalog, generation: 1, backend: "sqlite" };
    const semantic: SemanticMatch[] = [{ entryKey: entry.entryKey, entryContentHash: entry.contentHash,
      start: entry.displayText.indexOf("持久化"), end: entry.displayText.length, score: 0.85 }];
    const result = await searchHistory(request, context, signal(), undefined, semantic);
    expect(result.hits[0].snippet).toBe("持久化删除屏障"); expect(result.hits[0].matchSources).toEqual(["semantic"]);
    const hybrid = await searchHistory({ ...request, query: "删除屏障", mode: "hybrid" }, context, signal(), undefined, semantic);
    expect(hybrid.hits).toHaveLength(1); expect(hybrid.hits[0].matchSources).toEqual(["keyword", "semantic"]);
    expect(hybrid.rankingWindow).toBe(200);
    const gone = await searchHistory(request, context, signal(), undefined, [{ ...semantic[0], entryContentHash: "superseded" }]);
    expect(gone.hits).toEqual([]);
  });
  it("returns explicit keyword fallback rather than truncating an overlong model query", async () => {
    const context: HistoryQueryContext = { snapshot: snapshot(), catalog, generation: 1, backend: "sqlite" };
    const result = await searchHistory({ ...request, mode: "hybrid", query: "迟到" }, context, signal(), undefined, undefined,
      { code: "QUERY_TOO_LONG", message: "Exceeds model token limit", retryable: false });
    expect(result.modeUsed).toBe("keyword"); expect(result.rankingWindow).toBeNull(); expect(result.hits).toHaveLength(1);
    expect(result.warnings[0].code).toBe("QUERY_TOO_LONG");
  });
});
