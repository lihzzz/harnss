import fs from "node:fs/promises";
import { renameSync } from "node:fs";
import path from "node:path";
import type { HistoryIndexStatus, HistorySearchRequest } from "@shared/types/productivity";
import { operationError, ProductivityError } from "../productivity-errors";
import { HistorySqlite } from "./sqlite";
import { HistorySourceReader } from "./source";
import { emptyCoverage, type HistoryCatalog, type HistorySnapshot } from "./types";
import type { HistoryQueryContext } from "./query";
import { emptySemanticProgress, HistorySemantic } from "./semantic";
import { runtimeAlias } from "../session-replacements";

export class HistoryStore {
  private snapshot: HistorySnapshot = { conversations: new Map(), coverage: emptyCoverage(), warnings: [], signature: "" };
  private catalog: HistoryCatalog = { projects: [], spaces: [] };
  private database: HistorySqlite | null = null;
  private readonly reader: HistorySourceReader;
  private refreshTask: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private revision = 0;
  private initialized = false;
  private readonly blocked = new Set<string>();
  private rebuilding = false;
  private lastStatusSent = 0;
  private semanticConfiguration = "";
  private readonly semantic: HistorySemantic;
  private queryReaders = 0;
  private queryWaiters: Array<() => void> = [];
  private statusValue: HistoryIndexStatus = { seq: 0, generation: Date.now(), backend: "scan", state: "idle", coverage: emptyCoverage(), warnings: [], updatedAt: null, semanticState: "disabled", semanticProgress: emptySemanticProgress() };
  constructor(private readonly root: string, private readonly changed: (status: HistoryIndexStatus) => void) {
    this.reader = new HistorySourceReader(root);
    const semanticContext = () => {
      if (!this.database) throw new ProductivityError("INDEX_NOT_READY", "Semantic search requires the local history index. Rebuild it and retry.", true);
      return { database: this.database, snapshot: this.snapshot, catalog: this.catalog, revision: this.revision, generation: this.statusValue.generation };
    };
    this.semantic = new HistorySemantic(root, {
      read: async () => {
        await this.ready();
        while (this.refreshTask) await this.refreshTask;
        return semanticContext();
      },
      readQuery: async () => {
        await this.ready();
        while (this.refreshTask) await this.refreshTask;
        const context = semanticContext();
        this.queryReaders++;
        let released = false;
        return { ...context, release: () => {
          if (released) return;
          released = true;
          if (--this.queryReaders === 0) { const waiters = this.queryWaiters; this.queryWaiters = []; waiters.forEach((resolve) => resolve()); }
        } };
      },
      clearCache: async () => {
        await this.ready();
        return this.withWrite(() => semanticContext().database.clearSemantic());
      },
      commit: (key, entryKey, hash, revision, chunks, signal) => this.withWrite(() => {
        signal.throwIfAborted();
        if (!this.database || revision !== this.revision || this.blocked.has(key)) return false;
        if (!this.database.saveEmbeddings(entryKey, hash, this.statusValue.semanticProgress.modelKey ?? "", chunks)) return false;
        this.statusValue.generation++; return true;
      }),
      changed: (semantic, force) => {
        this.statusValue.semanticState = semantic.semanticState;
        this.statusValue.semanticProgress = semantic.semanticProgress;
        this.snapshot = { ...this.snapshot, coverage: { ...this.snapshot.coverage, semanticIndexed: semantic.indexedConversations, semanticComplete: semantic.complete } };
        this.statusValue.coverage = this.snapshot.coverage; this.publishStatus(force);
      },
    });
  }

  private waitForQueries(): Promise<void> {
    return this.queryReaders ? new Promise((resolve) => this.queryWaiters.push(resolve)) : Promise.resolve();
  }
  private async withWrite<T>(commit: () => T): Promise<T> {
    while (this.refreshTask || this.queryReaders) {
      if (this.refreshTask) await this.refreshTask; else await this.waitForQueries();
    }
    return commit();
  }

  configureSemantic(enabled: boolean, modelKey: string | null): void {
    const configuration = JSON.stringify([enabled, modelKey]);
    if (configuration === this.semanticConfiguration) return;
    this.semanticConfiguration = configuration; this.statusValue.generation++;
    this.semantic.configure(enabled, modelKey);
  }
  semanticSearch(request: HistorySearchRequest, signal: AbortSignal) { return this.semantic.search(request, signal); }
  async semanticControl(action: "pause" | "resume" | "clear"): Promise<void> {
    if (action === "pause") await this.semantic.pause();
    else if (action === "clear") { await this.semantic.clear(); this.statusValue.generation++; this.publishStatus(true); }
    else this.semantic.resume();
  }

  status(): HistoryIndexStatus { return structuredClone(this.statusValue); }
  setCatalog(catalog: HistoryCatalog): void {
    if (JSON.stringify(this.catalog) !== JSON.stringify(catalog)) { this.catalog = catalog; this.revision++; }
  }
  invalidate(): void { this.revision++; }
  sourceChanged(key: string, deleted: boolean): void {
    this.revision++;
    if (!deleted) { this.blocked.delete(key); return; }
    this.blocked.add(key);
    const conversations = new Map(this.snapshot.conversations);
    const removed = conversations.get(key);
    if (!removed) return;
    conversations.delete(key);
    const coverage = { ...this.snapshot.coverage, discovered: Math.max(0, this.snapshot.coverage.discovered - 1),
      indexed: Math.max(0, this.snapshot.coverage.indexed - (removed.damagedLines ? 0 : 1)),
      failed: Math.max(0, this.snapshot.coverage.failed - (removed.damagedLines ? 1 : 0)) };
    this.snapshot = { ...this.snapshot, conversations, coverage, signature: "" };
    this.statusValue.generation++;
    this.statusValue.coverage = coverage;
    this.publishStatus(true);
  }
  private publishStatus(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastStatusSent < 1000) return;
    this.lastStatusSent = now;
    this.statusValue.seq++;
    this.changed(this.status());
  }
  context(): HistoryQueryContext { return { snapshot: this.snapshot, catalog: this.catalog, generation: this.statusValue.generation,
    backend: this.database && !this.refreshTask ? "sqlite" : "scan" }; }
  candidates(query: string): ReadonlyMap<string, number> | undefined {
    if (this.refreshTask || !this.database) return undefined;
    try { return this.database.keywordCandidates(query); }
    catch (error) {
      this.database.close(); this.database = null;
      const warning = { ...operationError(error), code: "SCAN_FALLBACK" };
      this.snapshot = { ...this.snapshot, warnings: [...this.snapshot.warnings, warning] };
      this.statusValue.backend = "scan";
      this.statusValue.warnings = this.snapshot.warnings;
      this.publishStatus(true);
      return undefined;
    }
  }
  async ready(): Promise<void> {
    if (!this.initialized) await this.refresh();
    if (!this.initialized) throw new ProductivityError("INDEX_UNAVAILABLE", this.statusValue.warnings[0]?.message ?? "History could not be read", true);
  }

  refresh(rebuild = false, rebuildSemantic = false): Promise<void> {
    if (this.refreshTask) return this.refreshTask;
    this.rebuilding = rebuild;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.statusValue.state = rebuild ? "rebuilding" : "indexing";
    this.publishStatus(true);
    this.refreshTask = this.performRefresh(signal, rebuild, rebuildSemantic).catch((error: unknown) => {
      if (signal.aborted) { this.statusValue.state = "idle"; return; }
      this.statusValue.state = "error";
      this.statusValue.warnings = [operationError(error)];
      this.statusValue.coverage = { ...this.snapshot.coverage, keywordComplete: false };
    }).finally(() => { this.refreshTask = null; this.controller = null; this.rebuilding = false; this.publishStatus(true); });
    return this.refreshTask;
  }

  private async performRefresh(signal: AbortSignal, rebuild: boolean, rebuildSemantic: boolean): Promise<void> {
    while (this.queryReaders) await this.waitForQueries();
    signal.throwIfAborted();
    const folder = path.join(this.root, "history");
    const finalPath = path.join(folder, "index-v1.sqlite");
    const buildingPath = path.join(folder, "index-v1.building.sqlite");
    let target = this.database;
    let sqliteWarning: ReturnType<typeof operationError> | null = null;
    try {
      await fs.mkdir(folder, { recursive: true });
      if (rebuild) {
        this.reader.clearCache();
        for (const suffix of ["", "-wal", "-shm"]) await fs.rm(buildingPath + suffix, { force: true });
        target = new HistorySqlite(buildingPath);
      } else if (!target) target = new HistorySqlite(finalPath);
    } catch (error) { target = null; sqliteWarning = { ...operationError(error), code: "SCAN_FALLBACK" }; }
    let adopted = false;
    try {
      let snapshot: HistorySnapshot;
      let version: number;
      do {
        signal.throwIfAborted();
        version = this.revision;
        snapshot = await this.reader.scan(this.catalog, signal, (processed) => {
          this.statusValue.coverage = { ...this.snapshot.coverage, discovered: Math.max(processed, this.snapshot.coverage.discovered), keywordComplete: false };
          this.publishStatus();
        });
        for (const key of this.blocked) {
          const removed = snapshot.conversations.get(key);
          if (removed) {
            snapshot.conversations.delete(key);
            snapshot.coverage.discovered--;
            if (removed.damagedLines) snapshot.coverage.failed--; else snapshot.coverage.indexed--;
          }
        }
        if (target) {
          try { await target.sync(snapshot, this.statusValue.generation + 1, signal); }
          catch (error) {
            if (signal.aborted) throw error;
            target.close();
            if (target === this.database) this.database = null;
            target = null;
            sqliteWarning = { ...operationError(error), code: "SCAN_FALLBACK" };
          }
        }
        const [deleted, deletedProjects, replaced] = await Promise.all([this.reader.deletionKeys(), this.reader.deletedProjectIds(), this.reader.replacementVisibility()]);
        let removed = false;
        for (const [key, conversation] of snapshot.conversations) {
          if (!deleted.has(key) && !deletedProjects.has(conversation.projectId) && !replaced.logicalKeys.has(key)
            && !replaced.runtimeAliases.has(runtimeAlias(conversation.projectId, conversation.runtimeSessionId))) continue;
          snapshot.conversations.delete(key);
          snapshot.coverage.discovered--;
          if (conversation.damagedLines) snapshot.coverage.failed--; else snapshot.coverage.indexed--;
          removed = true;
        }
        // Re-read source barriers before the final revision check. Deletions and
        // replacements during that read or SQLite sync force a catch-up.
        if (removed) { this.reader.clearCache(); version = -1; }
        signal.throwIfAborted();
      } while (version !== this.revision);
      if (rebuild && target) {
        if (!rebuildSemantic && this.database) target.copySemanticFrom(this.database);
        target.close();
        target = null;
        this.database?.close();
        this.database = null;
        // A closed WAL connection checkpoints its pages before the atomic replacement.
        // This runs in the history worker. Keep replacement and publication in one
        // turn so a source-change event cannot slip between reconciliation and publish.
        renameSync(buildingPath, finalPath);
        target = new HistorySqlite(finalPath);
      }
      if (sqliteWarning) snapshot.warnings.push(sqliteWarning);
      if (snapshot.signature !== this.snapshot.signature || rebuild) this.statusValue.generation++;
      this.snapshot = snapshot;
      this.database = target;
      adopted = true;
      this.initialized = true;
      this.statusValue = { ...this.statusValue, state: "idle", backend: target ? "sqlite" : "scan", coverage: snapshot.coverage,
        warnings: snapshot.warnings, updatedAt: Date.now() };
      this.semantic.schedule();
    } finally {
      if (!adopted && target && target !== this.database) target.close();
      if (rebuild && !adopted) for (const suffix of ["", "-wal", "-shm"]) await fs.rm(buildingPath + suffix, { force: true });
    }
  }

  cancelRebuild(): void { if (this.rebuilding) this.controller?.abort(); }
  async close(): Promise<void> { this.controller?.abort(); await this.refreshTask; await this.semantic.close(); this.database?.close(); this.database = null; }
}
