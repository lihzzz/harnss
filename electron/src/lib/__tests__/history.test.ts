import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { historySnippet } from "@shared/lib/history-text";
import { historyDateRange, localDayStart } from "@shared/lib/history-time";
import type { HistorySearchRequest } from "@shared/types/productivity";
import { HistorySourceReader, extractHistoryConversation, parseHistorySource } from "../history/source";
import { activityHistory, searchHistory, timelineHistory, type HistoryQueryContext } from "../history/query";
import { HistorySqlite } from "../history/sqlite";
import { emptyCoverage, type HistoryCatalog } from "../history/types";
import { HistoryStore } from "../history/store";
import { serializeSessionJsonl } from "../session-jsonl";
import { createHash } from "node:crypto";

let root: string;
const catalog: HistoryCatalog = { projects: [{ id: "p1", name: "One", spaceId: "s1" }, { id: "p2", name: "Two", spaceId: "s2" }], spaces: [{ id: "s1", name: "Work" }, { id: "s2", name: "Personal" }] };
const request: HistorySearchRequest = { requestId: "search", query: "搜索", scope: { kind: "all" }, mode: "keyword", sort: "recent", engines: [], from: null, to: null, includeArchived: true, limit: 2, cursor: null };
const signal = () => new AbortController().signal;
const session = (id = "r1", projectId = "p1", conversationId = "conversation") => ({ id, projectId, conversationId, engine: "claude", createdAt: 10, title: "Search history", messages: [
  { id: "m1", role: "user", content: "搜索所有项目", timestamp: Date.parse("2026-03-08T06:30:00Z") },
  { id: "m2", role: "assistant", content: "搜索结果", timestamp: Date.parse("2026-03-08T07:30:00Z") },
] });
const context = (...data: Array<ReturnType<typeof session>>): HistoryQueryContext => {
  const conversations = data.map((item) => extractHistoryConversation(item, item.projectId, item.id, 1));
  return { catalog, generation: 1, backend: "scan", snapshot: { conversations: new Map(conversations.map((item) => [item.conversationKey, item])),
    coverage: { ...emptyCoverage(), discovered: conversations.length, indexed: conversations.length, keywordComplete: true }, warnings: [], signature: "initial" } };
};
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-history-")); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });
async function writeSession(data: Record<string, unknown>, name = "r1.jsonl"): Promise<void> {
  const dir = path.join(root, "sessions", String(data.projectId));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), name.endsWith(".jsonl") ? serializeSessionJsonl(data) : JSON.stringify(data));
}

describe("history extraction and coverage", () => {
  it("folds revisions in their original position, strips hidden attachments, and excludes queued/tool-result entries", () => {
    const source = serializeSessionJsonl(session()) + [
      JSON.stringify({ type: "msg", msg: { id: "m1", role: "user", content: '<file path="secret">hidden</file>搜索新内容', timestamp: 100 } }),
      JSON.stringify({ type: "msg", msg: { id: "queue", role: "user", content: "not sent", isQueued: true } }),
      JSON.stringify({ type: "msg", msg: { id: "tr", role: "tool_result", content: "hidden" } }),
      '{"type":"msg",',
    ].join("\n");
    const parsed = parseHistorySource(source, true);
    const result = extractHistoryConversation(parsed.data, "p1", "r1", 1, parsed.damagedLines);
    expect(result.entries.map((entry) => entry.messageId)).toEqual([null, "m1", "m2"]);
    expect(result.entries[1].displayText).toBe("搜索新内容");
    expect(result.damagedLines).toBe(1);
  });
  it("deduplicates runtime aliases but keeps different projects, with committed archive metadata", async () => {
    await writeSession(session("old"), "old.jsonl");
    await writeSession({ ...session("new"), messages: [{ id: "m1", role: "user", content: "latest", timestamp: 2e12 }] }, "new.jsonl");
    await writeSession(session("r1", "p2"));
    await writeSession({ ...session("new"), messages: undefined, archived: true }, "new.meta.json");
    const snapshot = await new HistorySourceReader(root).scan(catalog, signal(), () => {});
    expect(snapshot.conversations.size).toBe(2);
    expect([...snapshot.conversations.values()].find((item) => item.projectId === "p1")).toMatchObject({ runtimeSessionId: "new", archived: true });
    expect(snapshot.coverage).toMatchObject({ discovered: 2, indexed: 2, keywordComplete: true });
  });
  it("reports damaged sources separately from an empty search and tolerates valid legacy JSON over 5 MiB", async () => {
    const large = { ...session(), messages: [{ id: "m1", role: "user", content: "a".repeat(6 * 1024 * 1024) + "搜索", timestamp: 100 }] };
    await writeSession(large, "r1.json");
    await fs.writeFile(path.join(root, "sessions/p1/corrupt.json"), "{");
    const snapshot = await new HistorySourceReader(root).scan(catalog, signal(), () => {});
    expect(snapshot.coverage).toMatchObject({ discovered: 2, indexed: 1, failed: 1, keywordComplete: false });
    expect([...snapshot.conversations.values()][0].entries[1].displayText.endsWith("搜索")).toBe(true);
  });
  it("excludes durable deletion barriers even if a cached old snapshot remains on disk", async () => {
    await writeSession(session());
    const reader = new HistorySourceReader(root);
    const before = await reader.scan(catalog, signal(), () => {});
    const key = [...before.conversations.keys()][0];
    const directory = path.join(root, "sessions/.deletions");
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, `${createHash("sha256").update(key).digest("hex")}.json`), JSON.stringify({ conversationKey: key, state: "pending" }));
    expect((await reader.scan(catalog, signal(), () => {})).conversations.size).toBe(0);
  });
  it("does not replace missing timestamps with the current time or accept messages without stable IDs", () => {
    const value = extractHistoryConversation({ ...session(), createdAt: undefined, messages: [
      { id: "m1", role: "user", content: "text" }, { role: "user", content: "unlocatable" },
    ] }, "p1", "r1", 1);
    expect(value.entries.every((entry) => entry.timestamp === null && entry.timestampQuality === "unknown")).toBe(true);
    expect(value.damagedLines).toBe(1);
  });
});

describe("history queries", () => {
  it("paginates all matches and rejects cursors from another scope or generation", async () => {
    const ctx = context(session(), session("r2", "p2"));
    const first = await searchHistory(request, ctx, signal());
    expect(first.hits).toHaveLength(2);
    const second = await searchHistory({ ...request, requestId: "next", cursor: first.nextCursor }, ctx, signal());
    expect(new Set([...first.hits, ...second.hits].map((hit) => hit.hitId)).size).toBe(4);
    expect(second.nextCursor).toBeNull();
    await expect(searchHistory({ ...request, cursor: first.nextCursor }, { ...ctx, generation: 2 }, signal())).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
    await expect(searchHistory({ ...request, cursor: first.nextCursor, includeArchived: false }, ctx, signal())).rejects.toMatchObject({ code: "CURSOR_EXPIRED" });
  });
  it("applies space, engine, archive and half-open date filters together", async () => {
    const ctx = context(session(), { ...session("r2", "p2"), engine: "codex" });
    const result = await searchHistory({ ...request, scope: { kind: "space", spaceId: "s2" }, engines: ["codex"], from: Date.parse("2026-03-08T07:00:00Z"), to: Date.parse("2026-03-09T00:00:00Z") }, ctx, signal());
    expect(result.hits.map((hit) => [hit.projectId, hit.messageId])).toEqual([["p2", "m2"]]);
  });
  it("counts sent user IDs once and exposes unknown-time interactions separately", async () => {
    const data = { ...session(), messages: [...session().messages, { id: "m1", role: "user", content: "revised", timestamp: Date.parse("2026-03-08T06:30:00Z") },
      { id: "unknown", role: "user", content: "unknown", timestamp: 0 }] };
    const ctx = context(data);
    const activity = await activityHistory({ requestId: "activity", scope: { kind: "all" }, engines: [], includeArchived: true,
      fromDate: "2026-03-08", toDate: "2026-03-09", timeZone: "America/New_York" }, ctx, signal());
    expect(activity.days).toEqual([{ date: "2026-03-08", count: 1 }]);
    expect(activity.unknownUserCount).toBe(1);
    const timeline = await timelineHistory({ ...request, requestId: "timeline", unknownTime: true }, ctx, signal());
    expect(timeline.items.map((item) => item.messageId)).toEqual(["unknown"]);
  });
  it("distinguishes cancellation from zero matches", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(searchHistory(request, context(session()), controller.signal)).rejects.toThrow();
  });
  it("maps NFKC and grapheme matches to original UTF-16 offsets", () => {
    const text = "😀 ＡＢＣ ﬃ e\u0301 搜索";
    for (const [query, original] of [["abc", "ＡＢＣ"], ["ffi", "ﬃ"], ["é", "e\u0301"], ["搜索", "搜索"]]) {
      const value = historySnippet(text, query);
      const range = value.matchRanges[0];
      expect(value.snippet.slice(range.start, range.end)).toBe(original);
    }
  });
  it("uses 23-hour and 25-hour days for DST and validates calendar ranges", () => {
    expect(localDayStart("2026-03-09", "America/New_York") - localDayStart("2026-03-08", "America/New_York")).toBe(23 * 3600000);
    expect(localDayStart("2026-11-02", "America/New_York") - localDayStart("2026-11-01", "America/New_York")).toBe(25 * 3600000);
    expect(() => historyDateRange("2026-02-30", "2026-03-01")).toThrow();
    expect(() => historyDateRange("2025-01-01", "2026-01-03")).toThrow();
  });
});

describe("derived SQLite history", () => {
  it("reconciles updates arriving during the last deletion check before rebuild publication", async () => {
    await writeSession(session());
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready();
      const key = [...store.context().snapshot.conversations.keys()][0];
      const original = HistorySourceReader.prototype.deletionKeys;
      let reads = 0;
      vi.spyOn(HistorySourceReader.prototype, "deletionKeys").mockImplementation(async function (this: HistorySourceReader) {
        if (++reads === 2) {
          await writeSession({ ...session(), messages: [{ id: "latest", role: "user", content: "最新提交", timestamp: 2e12 }] });
          store.sourceChanged(key, false);
        }
        return original.call(this);
      });
      await store.refresh(true);
      expect(store.candidates("搜索")?.size).toBe(0);
      expect(store.candidates("最新提交")?.size).toBe(1);
      expect(store.context().snapshot.conversations.get(key)?.entries[1].messageId).toBe("latest");
    } finally { await store.close(); }
  });
  it("removes late durable deletions from the rebuilt database and its coverage together", async () => {
    await writeSession(session());
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready();
      const key = [...store.context().snapshot.conversations.keys()][0];
      const original = HistorySourceReader.prototype.deletionKeys;
      let reads = 0;
      vi.spyOn(HistorySourceReader.prototype, "deletionKeys").mockImplementation(async function (this: HistorySourceReader) {
        if (++reads === 2) {
          const directory = path.join(root, "sessions/.deletions");
          await fs.mkdir(directory);
          await fs.writeFile(path.join(directory, `${createHash("sha256").update(key).digest("hex")}.json`), JSON.stringify({ conversationKey: key, state: "committed" }));
        }
        return original.call(this);
      });
      await store.refresh(true);
      expect(store.candidates("搜索")?.size).toBe(0);
      expect(store.status().coverage).toMatchObject({ indexed: 0, discovered: 0 });
    } finally { await store.close(); }
  });
  it("excludes pending deletions from activity immediately, and restores them after a failed stop", async () => {
    await writeSession(session());
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready();
      const key = [...store.context().snapshot.conversations.keys()][0];
      store.sourceChanged(key, true);
      expect(store.context().snapshot.conversations.size).toBe(0);
      await store.refresh();
      expect(store.context().snapshot.conversations.size).toBe(0);
      store.sourceChanged(key, false); await store.refresh();
      expect(store.context().snapshot.conversations.size).toBe(1);
    } finally { await store.close(); }
  });
  it("keeps the old generation when a rebuild is cancelled", async () => {
    await writeSession(session());
    let cancel = false;
    const store = new HistoryStore(root, (status) => { if (cancel && status.state === "rebuilding") store.cancelRebuild(); });
    store.setCatalog(catalog);
    try {
      await store.ready(); const generation = store.status().generation;
      cancel = true; await store.refresh(true);
      expect(store.status().generation).toBe(generation);
      expect(store.candidates("搜索")?.size).toBe(2);
      expect(store.context().snapshot.conversations.size).toBe(1);
    } finally { await store.close(); }
  });
  it("falls back to source scanning for a damaged index and repairs it on rebuild", async () => {
    await writeSession(session()); await fs.mkdir(path.join(root, "history"));
    await fs.writeFile(path.join(root, "history/index-v1.sqlite"), "not a SQLite database");
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready();
      expect(store.status().backend).toBe("scan");
      expect(store.status().warnings.some((warning) => warning.code === "SCAN_FALLBACK")).toBe(true);
      expect((await searchHistory(request, store.context(), signal())).hits).toHaveLength(2);
      await store.refresh(true);
      expect(store.status().backend).toBe("sqlite");
      expect(store.candidates("搜索")?.size).toBe(2);
    } finally { await store.close(); }
  });
  it("treats Chinese short queries, punctuation and FTS operators as literal text and removes superseded messages", async () => {
    const db = new HistorySqlite(path.join(root, "test.sqlite"));
    try {
      const ctx = context({ ...session(), messages: [{ id: "m1", role: "user", content: '搜索 "foo" 100% a_b C:\\src\\file.ts OR NEAR', timestamp: 100 }] });
      await db.sync(ctx.snapshot, 1, signal());
      for (const query of ["搜索", '"foo"', "100%", "a_b", "C:\\src", "OR NEAR"]) expect(db.keywordCandidates(query).size).toBe(1);
      expect(db.keywordCandidates("foo OR missing").size).toBe(0);
      const empty = context({ ...session(), messages: [] });
      await db.sync(empty.snapshot, 2, signal());
      expect(db.keywordCandidates("搜索").size).toBe(0);
    } finally { db.close(); }
  });
  it("publishes an index, reuses unchanged generations, and reconciles overwritten and removed sources", async () => {
    await writeSession(session());
    const store = new HistoryStore(root, () => {}); store.setCatalog(catalog);
    try {
      await store.ready();
      expect(store.status()).toMatchObject({ backend: "sqlite", state: "idle", coverage: { indexed: 1, keywordComplete: true } });
      const generation = store.status().generation;
      await store.refresh();
      expect(store.status().generation).toBe(generation);
      await writeSession({ ...session(), messages: [] }); store.invalidate(); await store.refresh();
      expect(store.candidates("搜索")?.size).toBe(0);
      expect(store.status().generation).toBeGreaterThan(generation);
      await fs.unlink(path.join(root, "sessions/p1/r1.jsonl")); store.invalidate(); await store.refresh();
      expect(store.context().snapshot.conversations.size).toBe(0);
    } finally { await store.close(); }
  });
});
