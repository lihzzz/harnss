import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { getDataDir, getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { reportError } from "../lib/error-utils";
import { writeJsonAtomically } from "../lib/atomic-file";
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

function sanitizeExportFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return (cleaned || "session").slice(0, 80);
}

const sessionWriteQueue = new SessionWriteQueue();

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
  const fullParseFiles = allFiles.filter((file) =>
    file.endsWith(".json") && !file.endsWith(".meta.json") && !metaBasenames.has(file.replace(/\.json$/, "")),
  );

  const snapshots = await Promise.all([...metaFiles, ...fullParseFiles].map(async (file) => {
    try {
      const filePath = path.join(dir, file);
      const [raw, stat] = await Promise.all([
        fs.promises.readFile(filePath, "utf-8"),
        fs.promises.stat(filePath),
      ]);
      const data: Record<string, unknown> = JSON.parse(raw);
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
        const filePath = getSessionFilePath(data.projectId, data.id);
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

        await writeJsonAtomically(filePath, enriched);

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

  ipcMain.handle("sessions:load", async (_event, projectId: string, sessionId: string) => {
    try {
      const filePath = getSessionFilePath(projectId, sessionId);
      try {
        await fs.promises.access(filePath);
      } catch {
        return null;
      }
      return JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
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

        const filePath = getSessionFilePath(projectId, sessionId);
        try {
          const data = JSON.parse(await fs.promises.readFile(filePath, "utf-8"));
          if ("pinned" in patch) data.pinned = patch.pinned || undefined;
          if ("folderId" in patch) data.folderId = patch.folderId || undefined;
          if ("branch" in patch) data.branch = patch.branch || undefined;
          if ("archived" in patch) data.archived = patch.archived || undefined;
          await writeJsonAtomically(filePath, data);
        } catch (error) {
          // main file missing — nothing to patch
          if (!isMissingFileError(error)) throw error;
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
          const filePath = getSessionFilePath(projectId, session.id);
          try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > 5 * 1024 * 1024) continue;

            const raw = await fs.promises.readFile(filePath, "utf-8");
            const data = JSON.parse(raw);
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
      const filePath = getSessionFilePath(projectId, sessionId);
      let raw: string;
      try {
        raw = await fs.promises.readFile(filePath, "utf-8");
      } catch (err) {
        if (isMissingFileError(err)) return { error: "Session file not found" };
        throw err;
      }

      const data = JSON.parse(raw) as Record<string, unknown>;
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
