import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { reportError } from "../lib/error-utils";
import { writeJsonAtomically, writeTextAtomically } from "../lib/atomic-file";
import { parseSessionJsonl, serializeAppendLines, serializeSessionJsonl } from "../lib/session-jsonl";
import { SessionWriteQueue } from "../lib/session-write-queue";
import {
  getLastUserMessageTimestamp,
  extractSessionMeta,
  type SessionMeta,
} from "@shared/lib/session-persistence";
import { buildSessionMarkdown, type MarkdownMessage } from "@shared/lib/session-markdown";

interface SearchResult {
  messageResults: Array<{
    sessionId: string;
    projectId: string;
    sessionTitle: string;
    messageId: string;
    snippet: string;
    timestamp: number;
  }>;
  sessionResults: Array<{
    sessionId: string;
    projectId: string;
    title: string;
    createdAt: number;
  }>;
}

function getMetaFilePath(projectId: string, sessionId: string): string {
  return getSessionFilePath(projectId, sessionId).replace(/\.json$/, ".meta.json");
}

function getSessionJsonlPath(projectId: string, sessionId: string): string {
  return getSessionFilePath(projectId, sessionId).replace(/\.json$/, ".jsonl");
}

/** Read a session from disk, preferring the JSONL format and falling back to legacy .json. */
async function readSessionData(projectId: string, sessionId: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.promises.readFile(getSessionJsonlPath(projectId, sessionId), "utf-8");
    return parseSessionJsonl(raw);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  try {
    const raw = await fs.promises.readFile(getSessionFilePath(projectId, sessionId), "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeExportFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "session").slice(0, 80);
}

const sessionWriteQueue = new SessionWriteQueue();

/** Per-file append statistics for JSONL compaction (lines appended vs live messages). */
const appendStats = new Map<string, { appendedLines: number; liveMessages: number }>();
/** Rewrite the file once overridden/header lines exceed this multiple of live messages. */
const COMPACTION_RATIO = 3;

function sessionKey(projectId: string, sessionId: string): string {
  return `${projectId}/${sessionId}`;
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function conversationKey(session: SessionMeta): string {
  const engine = session.engine ?? "claude";
  const identity = engine === "codex" && session.codexThreadId
    ? session.codexThreadId
    : session.conversationId ?? session.id;
  return JSON.stringify([session.projectId, engine, identity]);
}

async function readSessionSnapshots(projectId: string): Promise<SessionMeta[]> {
  const dir = getProjectSessionsDir(projectId);
  const allFiles = await fs.promises.readdir(dir);
  const metaFiles = allFiles.filter((file) => file.endsWith(".meta.json"));
  const metaBasenames = new Set(metaFiles.map((file) => file.replace(/\.meta\.json$/, "")));
  const fullParseFiles = allFiles.filter((file) => {
    const isLegacyJson = file.endsWith(".json") && !file.endsWith(".meta.json");
    const isJsonl = file.endsWith(".jsonl");
    if (!isLegacyJson && !isJsonl) return false;
    const basename = file.replace(/\.jsonl?$/, "");
    return !metaBasenames.has(basename);
  });

  const snapshots = await Promise.all([...metaFiles, ...fullParseFiles].map(async (file) => {
    try {
      const filePath = path.join(dir, file);
      const [raw, stat] = await Promise.all([
        fs.promises.readFile(filePath, "utf-8"),
        fs.promises.stat(filePath),
      ]);
      const data: Record<string, unknown> = file.endsWith(".jsonl") ? parseSessionJsonl(raw) : JSON.parse(raw);
      const lastMessageAt = getLastUserMessageTimestamp(Array.isArray(data.messages) ? data.messages : undefined)
        ?? (typeof data.lastMessageAt === "number" ? data.lastMessageAt : undefined)
        ?? (typeof data.createdAt === "number" ? data.createdAt : 0);
      return { meta: extractSessionMeta(data, lastMessageAt), modifiedAt: stat.mtimeMs };
    } catch {
      // Skip unreadable snapshots, as in the legacy listing path.
      return null;
    }
  }));

  // A resumed runtime may have the same last user message as its predecessor.
  // Break ties by save time so the latest assistant output is retained.
  return snapshots.filter((snapshot) => snapshot !== null)
    .sort((a, b) => b.meta.lastMessageAt - a.meta.lastMessageAt || b.modifiedAt - a.modifiedAt)
    .map((snapshot) => snapshot.meta);
}

function latestConversations(snapshots: SessionMeta[]): SessionMeta[] {
  const seen = new Set<string>();
  return snapshots.filter((session) => {
    const key = conversationKey(session);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function deleteSessionSnapshot(projectId: string, sessionId: string): Promise<void> {
  await sessionWriteQueue.enqueue(sessionKey(projectId, sessionId), async () => {
    await Promise.all([
      getSessionFilePath(projectId, sessionId),
      getSessionJsonlPath(projectId, sessionId),
      getMetaFilePath(projectId, sessionId),
    ].map((filePath) => fs.promises.unlink(filePath).catch((error: unknown) => {
      if (!isMissingFileError(error)) throw error;
    })));
  });
}

export function register(): void {
  ipcMain.handle("sessions:save", async (_event, data: { projectId: string; id: string; createdAt?: number; messages?: Array<{ role?: string; timestamp?: number }> }, previousSessionId?: string) => {
    try {
      await sessionWriteQueue.enqueue(sessionKey(data.projectId, data.id), async () => {
        const jsonlPath = getSessionJsonlPath(data.projectId, data.id);
        const providedLastMessageAt = (data as Record<string, unknown>).lastMessageAt;
        const normalizedProvidedLastMessageAt =
          typeof providedLastMessageAt === "number" ? providedLastMessageAt : undefined;
        // Always prefer the latest user message timestamp when messages are present.
        const lastMessageAt =
          getLastUserMessageTimestamp(data.messages) ??
          normalizedProvidedLastMessageAt ??
          data.createdAt ??
          0;
        const enriched = { ...data, lastMessageAt };

        await writeTextAtomically(jsonlPath, serializeSessionJsonl(enriched as unknown as Record<string, unknown>));
        appendStats.delete(jsonlPath);

        // Retire the legacy single-JSON snapshot once the JSONL replacement is safe.
        await fs.promises.unlink(getSessionFilePath(data.projectId, data.id)).catch((error: unknown) => {
          if (!isMissingFileError(error)) throw error;
        });

        const meta = extractSessionMeta(enriched as unknown as Record<string, unknown>, lastMessageAt);
        await writeJsonAtomically(getMetaFilePath(data.projectId, data.id), meta);
      }, "save");
      // Only retire the previous runtime after both replacement files are safe.
      if (previousSessionId && previousSessionId !== data.id) {
        await deleteSessionSnapshot(data.projectId, previousSessionId);
      }
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:SAVE_ERR", err, { sessionId: data.id });
      return { error: message };
    }
  });

  // Incremental save: append only changed/new messages as JSONL lines (O(delta) writes).
  // The renderer reference-diffs against its last persisted snapshot and sends just the
  // delta in appendedMessages; structural changes (revert, retry, truncation) still come
  // through sessions:save as full rewrites. Append requires an existing snapshot — if the
  // file is missing the renderer must fall back to a full save.
  ipcMain.handle("sessions:append", async (_event, data: Record<string, unknown> & {
    projectId: string;
    id: string;
    appendedMessages?: Array<Record<string, unknown>>;
    messageCount?: number;
    lastMessageAt?: number;
  }, previousSessionId?: string) => {
    try {
      let needsFullSave = false;
      await sessionWriteQueue.enqueue(sessionKey(data.projectId, data.id), async () => {
        const jsonlPath = getSessionJsonlPath(data.projectId, data.id);
        const legacyPath = getSessionFilePath(data.projectId, data.id);
        const appended = Array.isArray(data.appendedMessages) ? data.appendedMessages : [];
        const { appendedMessages: _am, messageCount, ...header } = data;
        const liveMessages = typeof messageCount === "number" ? messageCount : appended.length;
        const lastMessageAt =
          getLastUserMessageTimestamp(appended as Array<{ role?: string; timestamp?: number }>) ??
          (typeof data.lastMessageAt === "number" ? data.lastMessageAt : 0);
        const enrichedHeader = { ...header, lastMessageAt };

        if (await fileExists(jsonlPath)) {
          // Compaction: rewrite once accumulated lines dwarf live content.
          let stats = appendStats.get(jsonlPath);
          if (!stats) {
            const raw = await fs.promises.readFile(jsonlPath, "utf-8");
            stats = { appendedLines: raw === "" ? 0 : raw.split("\n").length - 1, liveMessages };
            appendStats.set(jsonlPath, stats);
          }
          stats.appendedLines += 1 + appended.length;
          stats.liveMessages = liveMessages;

          if (stats.appendedLines > COMPACTION_RATIO * Math.max(1, stats.liveMessages)) {
            const current = parseSessionJsonl(await fs.promises.readFile(jsonlPath, "utf-8"));
            // Concatenation is safe: msg lines fold by id on load (last content wins,
            // first position kept), so appended edits land correctly.
            const merged = {
              ...current,
              ...enrichedHeader,
              messages: [...(current.messages as unknown[]), ...appended],
            };
            await writeTextAtomically(jsonlPath, serializeSessionJsonl(merged as Record<string, unknown>));
            appendStats.delete(jsonlPath);
          } else {
            await fs.promises.appendFile(jsonlPath, serializeAppendLines(enrichedHeader, appended), "utf-8");
          }
        } else if (await fileExists(legacyPath)) {
          // Migrate legacy single-JSON on first append: materialize JSONL from legacy
          // content + the incoming delta (fold-by-id handles edits to legacy messages),
          // then retire the legacy file.
          let base: Record<string, unknown> | null = null;
          try {
            base = JSON.parse(await fs.promises.readFile(legacyPath, "utf-8"));
          } catch {
            base = null; // corrupt legacy file — treat as missing
          }
          if (!base) {
            needsFullSave = true;
            return;
          }
          const merged = {
            ...base,
            ...enrichedHeader,
            messages: [...(Array.isArray(base.messages) ? base.messages : []), ...appended],
          };
          await writeTextAtomically(jsonlPath, serializeSessionJsonl(merged as Record<string, unknown>));
          appendStats.delete(jsonlPath);
          await fs.promises.unlink(legacyPath).catch((error: unknown) => {
            if (!isMissingFileError(error)) throw error;
          });
        } else {
          needsFullSave = true;
          return;
        }

        const meta = extractSessionMeta(enrichedHeader as Record<string, unknown>, lastMessageAt);
        await writeJsonAtomically(getMetaFilePath(data.projectId, data.id), meta);
      }, "save");

      if (needsFullSave) return { error: "append-before-save" };

      if (previousSessionId && previousSessionId !== data.id) {
        await deleteSessionSnapshot(data.projectId, previousSessionId);
      }
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:APPEND_ERR", err, { sessionId: data.id });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:load", async (_event, projectId: string, sessionId: string) => {
    try {
      return await readSessionData(projectId, sessionId);
    } catch (err) {
      reportError("SESSIONS:LOAD_ERR", err, { projectId, sessionId });
      return null;
    }
  });

  ipcMain.handle("sessions:list", async (_event, projectId: string) => {
    try {
      return latestConversations(await readSessionSnapshots(projectId));
    } catch (err) {
      reportError("SESSIONS:LIST_ERR", err, { projectId });
      return [];
    }
  });

  ipcMain.handle("sessions:update-meta", async (
    _event,
    { projectId, sessionId, patch }: {
      projectId: string;
      sessionId: string;
      patch: { pinned?: boolean; folderId?: string | null; branch?: string; archived?: boolean };
    },
  ) => {
    try {
      await sessionWriteQueue.enqueue(sessionKey(projectId, sessionId), async () => {
        const metaPath = getMetaFilePath(projectId, sessionId);
        try {
          const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
          if ("pinned" in patch) meta.pinned = patch.pinned || undefined;
          if ("folderId" in patch) meta.folderId = patch.folderId || undefined;
          if ("branch" in patch) meta.branch = patch.branch || undefined;
          if ("archived" in patch) meta.archived = patch.archived || undefined;
          await writeJsonAtomically(metaPath, meta);
        } catch (error) {
          // meta sidecar missing — it will be recreated on the next full save
          if (!isMissingFileError(error)) throw error;
        }

        const patchFields: Record<string, unknown> = {};
        // Explicit nulls: JSON.stringify drops undefined, which would turn an
        // "unpin/unarchive" into a no-op under header-fold (last-header-wins) semantics.
        if ("pinned" in patch) patchFields.pinned = patch.pinned ?? null;
        if ("folderId" in patch) patchFields.folderId = patch.folderId ?? null;
        if ("branch" in patch) patchFields.branch = patch.branch ?? null;
        if ("archived" in patch) patchFields.archived = patch.archived ?? null;

        const jsonlPath = getSessionJsonlPath(projectId, sessionId);
        const legacyPath = getSessionFilePath(projectId, sessionId);
        if (await fileExists(jsonlPath)) {
          // JSONL: a trailing header line patches meta fields (last header wins on load).
          await fs.promises.appendFile(jsonlPath, serializeAppendLines(patchFields, []), "utf-8");
        } else {
          try {
            const data = JSON.parse(await fs.promises.readFile(legacyPath, "utf-8"));
            Object.assign(data, patchFields);
            await writeJsonAtomically(legacyPath, data);
          } catch (error) {
            // main file missing — nothing to patch
            if (!isMissingFileError(error)) throw error;
          }
        }
      });

      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:UPDATE_META_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:delete", async (_event, projectId: string, sessionId: string) => {
    try {
      const snapshots = await readSessionSnapshots(projectId);
      const target = snapshots.find((session) => session.id === sessionId);
      const ids = target
        ? snapshots.filter((session) => conversationKey(session) === conversationKey(target)).map((session) => session.id)
        : [sessionId];
      // Retire legacy copies too, otherwise deleting the visible entry revives an older one.
      await Promise.all(ids.map((id) => deleteSessionSnapshot(projectId, id)));
      return { ok: true };
    } catch (err) {
      const message = reportError("SESSIONS:DELETE_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });

  ipcMain.handle("sessions:search", async (_event, { projectIds, query }: { projectIds: string[]; query: string }): Promise<SearchResult> => {
    try {
      const lowerQuery = query.toLowerCase();
      const messageResults: SearchResult["messageResults"] = [];
      const sessionResults: SearchResult["sessionResults"] = [];

      for (const projectId of projectIds) {
        const dir = path.join(getDataDir(), "sessions", projectId);
        try {
          await fs.promises.access(dir);
        } catch {
          continue;
        }

        const sessions = latestConversations(await readSessionSnapshots(projectId));
        for (const session of sessions) {
          const jsonlPath = getSessionJsonlPath(projectId, session.id);
          const legacyPath = getSessionFilePath(projectId, session.id);
          try {
            // JSONL parses line-by-line with constant memory per line, so the legacy
            // 5MB cap (which silently hid the largest sessions from search) does not
            // apply to it — only to whole-file JSON.parse of legacy snapshots.
            const isJsonl = await fileExists(jsonlPath);
            const filePath = isJsonl ? jsonlPath : legacyPath;
            if (!isJsonl) {
              const stat = await fs.promises.stat(filePath);
              if (stat.size > 5 * 1024 * 1024) continue;
            }

            const raw = await fs.promises.readFile(filePath, "utf-8");
            const data = isJsonl ? parseSessionJsonl(raw) : JSON.parse(raw);
            const sessionTitle = data.title || "Untitled";
            const sessionId = data.id;

            if (sessionTitle.toLowerCase().includes(lowerQuery)) {
              sessionResults.push({
                sessionId,
                projectId,
                title: sessionTitle,
                createdAt: data.createdAt || 0,
              });
            }

            if (messageResults.length >= 10) continue;
            const messages = data.messages || [];
            for (const msg of messages) {
              if (messageResults.length >= 10) break;
              if (msg.role !== "user" && msg.role !== "assistant") continue;
              if (!msg.content || typeof msg.content !== "string") continue;

              const idx = msg.content.toLowerCase().indexOf(lowerQuery);
              if (idx === -1) continue;

              const start = Math.max(0, idx - 30);
              const end = Math.min(msg.content.length, idx + query.length + 50);
              let snippet = msg.content.slice(start, end);
              if (start > 0) snippet = "..." + snippet;
              if (end < msg.content.length) snippet = snippet + "...";

              messageResults.push({
                sessionId,
                projectId,
                sessionTitle,
                messageId: msg.id,
                snippet,
                timestamp: msg.timestamp || data.createdAt || 0,
              });
            }
          } catch {
            // Skip corrupted files
          }
        }
      }

      return { messageResults, sessionResults };
    } catch (err) {
      reportError("SESSIONS:SEARCH_ERR", err, { query });
      return { messageResults: [], sessionResults: [] };
    }
  });

  ipcMain.handle("sessions:export-markdown", async (event, { projectId, sessionId }: { projectId: string; sessionId: string }) => {
    try {
      const data = await readSessionData(projectId, sessionId);
      if (!data) return { error: "Session file not found" };
      const messages = Array.isArray(data.messages) ? (data.messages as MarkdownMessage[]) : [];
      const lastMessageAt = getLastUserMessageTimestamp(data.messages as Array<{ role?: string; timestamp?: number }>) ?? 0;
      const markdown = buildSessionMarkdown(extractSessionMeta(data, lastMessageAt), messages);

      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: "Export Session as Markdown",
        defaultPath: path.join(app.getPath("documents"), `${sanitizeExportFileName(String(data.title ?? "session"))}.md`),
        filters: [{ name: "Markdown", extensions: ["md"] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);

      if (result.canceled || !result.filePath) return { canceled: true };

      await fs.promises.writeFile(result.filePath, markdown, "utf-8");
      return { ok: true, filePath: result.filePath };
    } catch (err) {
      const message = reportError("SESSIONS:EXPORT_MD_ERR", err, { projectId, sessionId });
      return { error: message };
    }
  });
}
