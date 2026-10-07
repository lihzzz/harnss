import { DatabaseSync } from "node:sqlite";
import { normalizeHistoryText } from "@shared/lib/history-text";
import { ProductivityError } from "../productivity-errors";
import type { HistoryConversation, HistorySnapshot } from "./types";
import type { HistoryChunk } from "./chunks";
import type { HistorySearchRequest } from "@shared/types/productivity";

export interface StoredHistoryChunk extends HistoryChunk { contentHash: string; vector: Float32Array }
export interface VectorHistoryRow { entryKey: string; start: number; end: number; entryContentHash: string; vector: Uint8Array; dimensions: number; norm: number }

/** Derived cache only. This module is loaded in the history worker, never in Electron's UI process. */
export class HistorySqlite {
  private readonly database: DatabaseSync;
  constructor(readonly file: string) {
    const db = this.database = new DatabaseSync(file, { enableForeignKeyConstraints: true, allowExtension: false });
    try {
      db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=1000");
      const version = db.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 0 && version !== 1) throw new ProductivityError("INDEX_VERSION_UNSUPPORTED");
      db.exec(`
        CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS conversations (conversationKey TEXT PRIMARY KEY, projectId TEXT NOT NULL,
          runtimeSessionId TEXT NOT NULL, engine TEXT NOT NULL, agentId TEXT, title TEXT NOT NULL,
          archived INTEGER NOT NULL, createdAt REAL, sourceRevision TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS entries (entryKey TEXT PRIMARY KEY, conversationKey TEXT NOT NULL REFERENCES conversations(conversationKey) ON DELETE CASCADE,
          messageId TEXT, kind TEXT NOT NULL, sourceOrder INTEGER NOT NULL, timestamp REAL, timestampQuality TEXT NOT NULL,
          displayText TEXT NOT NULL, searchText TEXT NOT NULL, contentHash TEXT NOT NULL, isComplete INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS entries_conversation ON entries(conversationKey);
        CREATE INDEX IF NOT EXISTS entries_time ON entries(kind, timestamp);
        CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(searchText, content='entries', content_rowid='rowid', tokenize='trigram case_sensitive 1');
        CREATE TRIGGER IF NOT EXISTS entries_insert AFTER INSERT ON entries WHEN new.kind IN ('title', 'user', 'assistant') BEGIN
          INSERT INTO entries_fts(rowid, searchText) VALUES (new.rowid, new.searchText); END;
        CREATE TRIGGER IF NOT EXISTS entries_delete AFTER DELETE ON entries WHEN old.kind IN ('title', 'user', 'assistant') BEGIN
          INSERT INTO entries_fts(entries_fts, rowid, searchText) VALUES ('delete', old.rowid, old.searchText); END;
        CREATE TRIGGER IF NOT EXISTS entries_update AFTER UPDATE OF searchText,kind ON entries
          WHEN old.searchText<>new.searchText OR old.kind<>new.kind BEGIN
          INSERT INTO entries_fts(entries_fts,rowid,searchText) SELECT 'delete',old.rowid,old.searchText WHERE old.kind IN ('title','user','assistant');
          INSERT INTO entries_fts(rowid,searchText) SELECT new.rowid,new.searchText WHERE new.kind IN ('title','user','assistant'); END;
        CREATE TABLE IF NOT EXISTS embeddings (contentHash TEXT NOT NULL, modelKey TEXT NOT NULL,
          dimensions INTEGER NOT NULL, norm REAL NOT NULL, vector BLOB NOT NULL, PRIMARY KEY(contentHash,modelKey));
        CREATE TABLE IF NOT EXISTS chunks (entryKey TEXT NOT NULL REFERENCES entries(entryKey) ON DELETE CASCADE,
          modelKey TEXT NOT NULL, chunkIndex INTEGER NOT NULL, startOffset INTEGER NOT NULL, endOffset INTEGER NOT NULL,
          contentHash TEXT NOT NULL, entryContentHash TEXT NOT NULL, PRIMARY KEY(entryKey,modelKey,chunkIndex));
        CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks(contentHash,modelKey);
        CREATE TABLE IF NOT EXISTS embedding_progress (entryKey TEXT NOT NULL REFERENCES entries(entryKey) ON DELETE CASCADE,
          modelKey TEXT NOT NULL, entryContentHash TEXT NOT NULL, PRIMARY KEY(entryKey,modelKey));
        PRAGMA user_version=1;
      `);
    } catch (error) { db.close(); throw error; }
  }

  async sync(snapshot: HistorySnapshot, generation: number, signal: AbortSignal): Promise<void> {
    const db = this.database;
    const revisions = new Map(db.prepare("SELECT conversationKey, sourceRevision FROM conversations").all().flatMap((row) =>
      typeof row.conversationKey === "string" && typeof row.sourceRevision === "string" ? [[row.conversationKey, row.sourceRevision] as const] : []));
    let processed = 0;
    for (const conversation of snapshot.conversations.values()) {
      signal.throwIfAborted();
      if (revisions.get(conversation.conversationKey) !== conversation.sourceRevision) await this.upsert(conversation, signal);
      revisions.delete(conversation.conversationKey);
      if (++processed % 16 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (const key of revisions.keys()) db.prepare("DELETE FROM conversations WHERE conversationKey=?").run(key);
    this.pruneEmbeddings();
    const meta = db.prepare("INSERT OR REPLACE INTO index_meta(key,value) VALUES (?,?)");
    meta.run("generation", String(generation));
    meta.run("extractorVersion", "1");
    meta.run("coverage", JSON.stringify(snapshot.coverage));
  }

  private async upsert(conversation: HistoryConversation, signal: AbortSignal): Promise<void> {
    const db = this.database;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`INSERT INTO conversations VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(conversationKey) DO UPDATE SET
        projectId=excluded.projectId,runtimeSessionId=excluded.runtimeSessionId,engine=excluded.engine,agentId=excluded.agentId,
        title=excluded.title,archived=excluded.archived,createdAt=excluded.createdAt,sourceRevision=excluded.sourceRevision`).run(conversation.conversationKey, conversation.projectId, conversation.runtimeSessionId,
        conversation.engine, conversation.agentId, conversation.title, Number(conversation.archived), conversation.createdAt, conversation.sourceRevision);
      const removed = new Set(db.prepare("SELECT entryKey FROM entries WHERE conversationKey=?").all(conversation.conversationKey).flatMap((row) => typeof row.entryKey === "string" ? [row.entryKey] : []));
      const insert = db.prepare(`INSERT INTO entries VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entryKey) DO UPDATE SET
        messageId=excluded.messageId,kind=excluded.kind,sourceOrder=excluded.sourceOrder,timestamp=excluded.timestamp,timestampQuality=excluded.timestampQuality,
        displayText=excluded.displayText,searchText=excluded.searchText,contentHash=excluded.contentHash,isComplete=excluded.isComplete`);
      let processed = 0;
      for (const entry of conversation.entries) {
        removed.delete(entry.entryKey);
        insert.run(entry.entryKey, conversation.conversationKey, entry.messageId, entry.kind, entry.sourceOrder,
          entry.timestamp, entry.timestampQuality, entry.displayText, entry.searchText, entry.contentHash, Number(entry.isComplete));
        if (++processed % 512 === 0) { await new Promise<void>((resolve) => setImmediate(resolve)); signal.throwIfAborted(); }
      }
      for (const key of removed) db.prepare("DELETE FROM entries WHERE entryKey=?").run(key);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  hasEmbedding(entryKey: string, contentHash: string, modelKey: string): boolean {
    return Boolean(this.database.prepare("SELECT 1 FROM embedding_progress WHERE entryKey=? AND entryContentHash=? AND modelKey=?").get(entryKey, contentHash, modelKey));
  }

  cachedVector(contentHash: string, modelKey: string, dimensions: number): Float32Array | null {
    const row = this.database.prepare("SELECT vector,dimensions FROM embeddings WHERE contentHash=? AND modelKey=?").get(contentHash, modelKey);
    if (!row) return null;
    if (!(row.vector instanceof Uint8Array) || row.dimensions !== dimensions || row.vector.byteLength !== dimensions * 4) throw new ProductivityError("SEMANTIC_CACHE_INVALID");
    const bytes = new DataView(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength);
    return Float32Array.from({ length: dimensions }, (_, index) => bytes.getFloat32(index * 4, true));
  }

  /** Caller serializes this commit with source sync and checks the source revision. */
  saveEmbeddings(entryKey: string, entryContentHash: string, modelKey: string, chunks: StoredHistoryChunk[]): boolean {
    const db = this.database;
    if (db.prepare("SELECT contentHash FROM entries WHERE entryKey=?").get(entryKey)?.contentHash !== entryContentHash) return false;
    const previous = db.prepare("SELECT DISTINCT contentHash,modelKey FROM chunks WHERE entryKey=?").all(entryKey);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM chunks WHERE entryKey=?").run(entryKey);
      db.prepare("DELETE FROM embedding_progress WHERE entryKey=?").run(entryKey);
      const vectorInsert = db.prepare("INSERT OR IGNORE INTO embeddings VALUES (?,?,?,?,?)");
      const chunkInsert = db.prepare("INSERT INTO chunks VALUES (?,?,?,?,?,?,?)");
      for (const chunk of chunks) {
        let norm = 0;
        const bytes = Buffer.allocUnsafe(chunk.vector.length * 4);
        for (let index = 0; index < chunk.vector.length; index++) {
          const number = chunk.vector[index];
          if (!Number.isFinite(number)) throw new ProductivityError("MODEL_OUTPUT_INVALID");
          norm += number * number; bytes.writeFloatLE(number, index * 4);
        }
        if (!norm) throw new ProductivityError("MODEL_OUTPUT_INVALID");
        vectorInsert.run(chunk.contentHash, modelKey, chunk.vector.length, Math.sqrt(norm), bytes);
        chunkInsert.run(entryKey, modelKey, chunk.index, chunk.start, chunk.end, chunk.contentHash, entryContentHash);
      }
      db.prepare("INSERT INTO embedding_progress VALUES (?,?,?)").run(entryKey, modelKey, entryContentHash);
      const prune = db.prepare("DELETE FROM embeddings WHERE contentHash=? AND modelKey=? AND NOT EXISTS (SELECT 1 FROM chunks WHERE chunks.contentHash=embeddings.contentHash AND chunks.modelKey=embeddings.modelKey)");
      for (const old of previous) if (typeof old.contentHash === "string" && typeof old.modelKey === "string") prune.run(old.contentHash, old.modelKey);
      db.exec("COMMIT");
      return true;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }

  *vectors(projects: string[], request: HistorySearchRequest, modelKey: string): Generator<VectorHistoryRow> {
    if (!projects.length) return;
    const clauses = [`p.projectId IN (${projects.map(() => "?").join(",")})`, "c.modelKey=?", "c.entryContentHash=e.contentHash", "e.kind IN ('title','user','assistant')"];
    const args: Array<string | number> = [...projects, modelKey];
    if (!request.includeArchived) clauses.push("p.archived=0");
    if (request.engines.length) { clauses.push(`p.engine IN (${request.engines.map(() => "?").join(",")})`); args.push(...request.engines); }
    if (request.from !== null) { clauses.push("e.timestamp>=?"); args.push(request.from); }
    if (request.to !== null) { clauses.push("e.timestamp<?"); args.push(request.to); }
    const rows = this.database.prepare(`SELECT c.entryKey,c.startOffset,c.endOffset,c.entryContentHash,v.vector,v.dimensions,v.norm
      FROM chunks c JOIN entries e ON e.entryKey=c.entryKey JOIN conversations p ON p.conversationKey=e.conversationKey
      JOIN embeddings v ON v.contentHash=c.contentHash AND v.modelKey=c.modelKey WHERE ${clauses.join(" AND ")}`).iterate(...args);
    for (const row of rows) {
      if (typeof row.entryKey !== "string" || typeof row.startOffset !== "number" || typeof row.endOffset !== "number"
        || typeof row.entryContentHash !== "string" || !(row.vector instanceof Uint8Array) || typeof row.dimensions !== "number" || typeof row.norm !== "number") throw new ProductivityError("SEMANTIC_CACHE_INVALID");
      yield { entryKey: row.entryKey, start: row.startOffset, end: row.endOffset, entryContentHash: row.entryContentHash,
        vector: row.vector, dimensions: row.dimensions, norm: row.norm };
    }
  }

  clearSemantic(): void { this.database.exec("BEGIN IMMEDIATE; DELETE FROM chunks; DELETE FROM embedding_progress; DELETE FROM embeddings; COMMIT"); }

  copySemanticFrom(previous: HistorySqlite): void {
    this.database.prepare("ATTACH DATABASE ? AS previous").run(previous.file);
    try {
      this.database.exec(`INSERT OR IGNORE INTO chunks SELECT c.* FROM previous.chunks c JOIN entries e ON e.entryKey=c.entryKey AND e.contentHash=c.entryContentHash;
        INSERT OR IGNORE INTO embeddings SELECT v.* FROM previous.embeddings v WHERE EXISTS (SELECT 1 FROM chunks c WHERE c.contentHash=v.contentHash AND c.modelKey=v.modelKey);
        INSERT OR IGNORE INTO embedding_progress SELECT p.* FROM previous.embedding_progress p JOIN entries e ON e.entryKey=p.entryKey AND e.contentHash=p.entryContentHash;`);
    } finally { this.database.exec("DETACH DATABASE previous"); }
  }
  private pruneEmbeddings(): void {
    this.database.exec("DELETE FROM embeddings WHERE NOT EXISTS (SELECT 1 FROM chunks WHERE chunks.contentHash=embeddings.contentHash AND chunks.modelKey=embeddings.modelKey)");
  }

  keywordCandidates(rawQuery: string): Map<string, number> {
    const query = normalizeHistoryText(rawQuery.trim());
    // FTS syntax is never accepted from the user; even quotes and operators are literal.
    const phrase = `"${query.replace(/"/g, '""')}"`;
    const rows = [...query].length >= 3 && !query.includes("\0")
      ? this.database.prepare("SELECT e.entryKey,bm25(entries_fts) AS rank FROM entries_fts f JOIN entries e ON e.rowid=f.rowid WHERE entries_fts MATCH ? AND instr(e.searchText,?)>0").all(phrase, query)
      : this.database.prepare("SELECT entryKey,0 AS rank FROM entries WHERE kind IN ('title','user','assistant') AND instr(searchText,?)>0").all(query);
    return new Map(rows.flatMap((row) => typeof row.entryKey === "string" && typeof row.rank === "number" ? [[row.entryKey, row.rank] as const] : []));
  }

  close(): void { this.database.close(); }
}
