import { parentPort, workerData } from "node:worker_threads";
import { failure, isRecord, operationError, ProductivityError } from "../productivity-errors";
import { HistoryStore } from "./store";
import { activityHistory, searchHistory, timelineHistory } from "./query";
import type { HistoryWorkerRequest, HistoryWorkerResponse, HistoryWorkerValue } from "./worker-protocol";
import type { SemanticMatch } from "./semantic";
import type { OperationError } from "@shared/types/productivity";

const port = parentPort;
if (!port || !isRecord(workerData) || typeof workerData.root !== "string") throw new Error("Invalid history worker startup");
const send = (message: HistoryWorkerResponse) => port.postMessage(message);
const store = new HistoryStore(workerData.root, (value) => send({ type: "status", value }));
const queries = new Map<string, AbortController>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function handle(message: HistoryWorkerRequest): Promise<HistoryWorkerValue> {
  store.setCatalog(message.catalog);
  if (message.semantic) store.configureSemantic(message.semantic.semanticEnabled, message.semantic.embeddingModelKey);
  switch (message.action) {
    case "cancel": queries.get(message.requestId)?.abort(); return null;
    case "cancelRebuild": store.cancelRebuild(); return store.status();
    case "status": return store.status();
    case "close": {
      if (refreshTimer) clearTimeout(refreshTimer);
      for (const query of queries.values()) query.abort();
      await store.close();
      return null;
    }
    case "change":
    case "refresh": {
      if (message.action === "change") store.sourceChanged(message.change.conversationKey, message.change.kind === "delete");
      store.invalidate();
      if (!refreshTimer) refreshTimer = setTimeout(() => { refreshTimer = null; void store.refresh(); }, 250);
      return store.status();
    }
    case "rebuild": void store.refresh(true, message.kind === "all"); return store.status();
    case "semanticControl": await store.semanticControl(message.control); return store.status();
    default: break;
  }
  const id = "requestId" in message.request ? message.request.requestId : message.id;
  queries.get(id)?.abort();
  const controller = new AbortController();
  queries.set(id, controller);
  try {
    if (message.action === "resolve") { store.invalidate(); await store.refresh(); }
    await store.ready();
    controller.signal.throwIfAborted();
    if (message.action === "search") {
      let semantic: SemanticMatch[] | undefined;
      let semanticError: OperationError | undefined;
      let queryContext = store.context();
      let releaseQuery: (() => void) | undefined;
      try {
      if (message.request.mode !== "keyword") {
        try {
          const value = await store.semanticSearch(message.request, controller.signal);
          releaseQuery = value.release;
          queryContext = value.context;
          if (value.context.generation !== store.context().generation) throw new ProductivityError("CURSOR_EXPIRED", "History changed. Refresh the results.", true);
          semantic = value.matches;
        } catch (error) {
          if (message.request.mode === "semantic" || controller.signal.aborted || error instanceof ProductivityError && error.code === "CURSOR_EXPIRED") throw error;
          semanticError = operationError(error);
        }
      }
      const candidates = store.candidates(message.request.query);
      const context = semantic ? queryContext : store.context();
      const result = await searchHistory(message.request, context, controller.signal, candidates, semantic, semanticError);
      if (store.context().generation !== context.generation) throw new ProductivityError("CURSOR_EXPIRED", "History changed. Refresh the results.", true);
      return result;
      } finally { releaseQuery?.(); }
    }
    const context = store.context();
    if (message.action === "timeline") return await timelineHistory(message.request, context, controller.signal);
    if (message.action === "activity") return await activityHistory(message.request, context, controller.signal);
    const conversation = context.snapshot.conversations.get(message.request.conversationKey);
    if (!conversation || conversation.projectId !== message.request.projectId
      || message.request.messageId !== null && !conversation.entries.some((entry) => entry.messageId === message.request.messageId)) throw new ProductivityError("SOURCE_GONE", "The original conversation or message is no longer available", true);
    return { ...message.request, runtimeSessionId: conversation.runtimeSessionId,
      spaceId: context.catalog.projects.find((project) => project.id === conversation.projectId)?.spaceId ?? null };
  } catch (error) {
    if (controller.signal.aborted) throw new ProductivityError("CANCELLED");
    throw error;
  } finally { if (queries.get(id) === controller) queries.delete(id); }
}

port.on("message", (message: HistoryWorkerRequest) => {
  void handle(message).then((value) => send({ type: "reply", id: message.id, result: { ok: true, value } }),
    (error: unknown) => send({ type: "reply", id: message.id, result: failure(error) }));
});
