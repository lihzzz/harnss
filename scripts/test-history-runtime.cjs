// Run with the actual Electron binary after pnpm build:electron. No user data is opened.
const { app } = require("electron");
const { Worker } = require("node:worker_threads");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const workerFile = process.argv[2] || path.resolve(__dirname, "../electron/dist/history-worker.js");
let worker;
let root;
const timeout = setTimeout(() => { console.error("History runtime check timed out"); app.exit(1); }, 60_000);
app.whenReady().then(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-history-runtime-"));
  await fs.mkdir(path.join(root, "sessions/project"), { recursive: true });
  const data = { id: "runtime", projectId: "project", conversationId: "conversation", title: "本地历史", createdAt: 1,
    messages: Array.from({ length: 35 }, (_, index) => ({ id: `message-${index}`, role: "user", content: `搜索 local history ${index}`, timestamp: Date.parse("2026-03-08T07:00:00Z") + index })) };
  await fs.writeFile(path.join(root, "sessions/project/runtime.json"), JSON.stringify(data));
  const catalog = { projects: [{ id: "project", name: "Runtime check", spaceId: "default" }], spaces: [{ id: "default", name: "General" }] };
  worker = new Worker(workerFile, { workerData: { root } });
  const pending = new Map();
  worker.on("message", (message) => {
    if (message.type !== "reply") return;
    const task = pending.get(message.id); if (!task) return;
    pending.delete(message.id);
    if (message.result.ok) task.resolve(message.result.value); else task.reject(new Error(JSON.stringify(message.result.error)));
  });
  worker.on("error", (error) => { for (const task of pending.values()) task.reject(error); pending.clear(); });
  const call = (command) => new Promise((resolve, reject) => {
    const id = crypto.randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ ...command, id, catalog });
  });
  const request = { requestId: "search", query: "搜索", scope: { kind: "all" }, mode: "keyword", sort: "recent", engines: [], from: null, to: null, includeArchived: true, limit: 30, cursor: null };
  const start = performance.now();
  const first = await call({ action: "search", request });
  assert.equal(first.backend, "sqlite"); assert.equal(first.hits.length, 30); assert.equal(first.coverage.keywordComplete, true);
  const next = await call({ action: "search", request: { ...request, requestId: "next", cursor: first.nextCursor } });
  assert.equal(next.hits.length, 5); assert.equal(next.nextCursor, null);
  const activity = await call({ action: "activity", request: { requestId: "activity", scope: { kind: "all" }, engines: [], includeArchived: true,
    fromDate: "2026-03-08", toDate: "2026-03-09", timeZone: "America/New_York" } });
  assert.equal(activity.days[0].count, 35);
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
    backend: first.backend, matches: first.hits.length + next.hits.length, sentQuestions: activity.days[0].count, elapsedMs: Math.round(performance.now() - start) }));
  await call({ action: "close" }); await worker.terminate(); worker = null;
  await fs.rm(root, { recursive: true, force: true }); root = null;
  clearTimeout(timeout); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  if (worker) await worker.terminate();
  if (root) await fs.rm(root, { recursive: true, force: true });
  clearTimeout(timeout); app.exit(1);
});
