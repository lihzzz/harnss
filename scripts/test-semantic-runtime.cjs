// Actual Electron + nested embedding worker. Optional argument seeds the isolated
// model cache from a previous download; no user conversations or settings are read.
const { app } = require("electron");
const { Worker } = require("node:worker_threads");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
let root, worker;
const timeout = setTimeout(() => { console.error("Semantic runtime test timed out"); app.exit(1); }, 180_000);
app.whenReady().then(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-semantic-"));
  if (process.argv[2]) await fs.cp(path.resolve(process.argv[2]), path.join(root, "history/models"), { recursive: true });
  const catalog = { projects: [{ id: "one", name: "Work", spaceId: "work" }, { id: "two", name: "Personal", spaceId: "personal" }],
    spaces: [{ id: "work", name: "Work" }, { id: "personal", name: "Personal" }] };
  const texts = [
    ["delete", "删除会话前先建立持久化屏障，迟到的写入任务必须检查删除记录并拒绝保存。"],
    ["calendar", "日历热力图使用每条已发送用户消息计数，按设备时区汇总，折叠消息修订。"],
    ["hotkey", "Enable keepAliveOnClose to hide the main window while keeping the process and hotkeys running."],
    ["export", "批量导出只弹一次目录选择窗口，每个对话生成一个 Markdown 文件，并保留已完成的文件。"],
  ];
  for (const project of catalog.projects) {
    await fs.mkdir(path.join(root, "sessions", project.id), { recursive: true });
    await fs.writeFile(path.join(root, "sessions", project.id, "runtime.json"), JSON.stringify({ id: "runtime", projectId: project.id,
      conversationId: "thread", engine: "claude", title: `Project ${project.id}`, archived: project.id === "two", createdAt: 1,
      messages: texts.map(([id, content], index) => ({ id, content, role: "user", timestamp: 100 + index })) }));
  }
  worker = new Worker(process.argv[3] ? path.resolve(process.argv[3]) : path.resolve(__dirname, "../electron/dist/history-worker.js"), { workerData: { root } });
  const pending = new Map();
  let status, semantic = { semanticEnabled: true, embeddingModelKey: null };
  worker.on("message", (message) => {
    if (message.type === "status") { status = message.value; return; }
    const task = pending.get(message.id); if (!task) return; pending.delete(message.id);
    if (message.result.ok) task.resolve(message.result.value); else task.reject(Object.assign(new Error(message.result.error.message), { code: message.result.error.code }));
  });
  worker.on("error", (error) => { for (const task of pending.values()) task.reject(error); pending.clear(); });
  const call = (command) => new Promise((resolve, reject) => { const id = randomUUID(); pending.set(id, { resolve, reject }); worker.postMessage({ ...command, id, catalog, semantic }); });
  const started = performance.now();
  await call({ action: "refresh" });
  while (!status || !["ready", "error"].includes(status.semanticState)) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(status.semanticState, "ready", JSON.stringify(status.semanticProgress));
  assert.equal(status.coverage.semanticComplete, true);
  const readyMs = Math.round(performance.now() - started);
  const request = { requestId: "semantic", query: "怎么阻止删掉的聊天被后台又存回来", scope: { kind: "all" }, mode: "semantic", sort: "relevance",
    engines: [], from: null, to: null, includeArchived: false, limit: 30, cursor: null };
  const queryStart = performance.now();
  const result = await call({ action: "search", request });
  assert.equal(result.hits[0].messageId, "delete"); assert.equal(result.modeUsed, "semantic");
  assert.ok(result.hits.every((hit) => hit.projectId === "one")); assert.equal(result.rankingWindow, 200);
  const queryMs = Math.round(performance.now() - queryStart);
  const scoped = await call({ action: "search", request: { ...request, requestId: "scope", scope: { kind: "space", spaceId: "personal" }, includeArchived: true } });
  assert.ok(scoped.hits.length > 0 && scoped.hits.every((hit) => hit.projectId === "two" && hit.archived));
  const english = await call({ action: "search", request: { ...request, requestId: "en", query: "Which setting keeps keyboard activation available after closing the app window?" } });
  assert.equal(english.hits[0].messageId, "hotkey");
  const hybrid = await call({ action: "search", request: { ...request, requestId: "hybrid", query: "删除记录", mode: "hybrid" } });
  assert.deepEqual(hybrid.hits[0].matchSources, ["keyword", "semantic"]);
  await assert.rejects(call({ action: "search", request: { ...request, requestId: "long", query: "的".repeat(512) } }), { code: "QUERY_TOO_LONG" });
  const fallback = await call({ action: "search", request: { ...request, requestId: "fallback", query: "的".repeat(512), mode: "hybrid" } });
  assert.equal(fallback.modeUsed, "keyword"); assert.ok(fallback.warnings.some((warning) => warning.code === "QUERY_TOO_LONG"));
  await call({ action: "semanticControl", control: "pause" });
  semantic = { semanticEnabled: false, embeddingModelKey: null };
  await call({ action: "semanticControl", control: "clear" });
  assert.equal(await fs.stat(path.join(root, "history/models")).then(() => true, () => false), false);
  const keyword = await call({ action: "search", request: { ...request, requestId: "kept", query: "删除记录", mode: "keyword" } });
  assert.equal(keyword.hits[0].messageId, "delete");
  console.log(JSON.stringify({ electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
    readyMs, queryMs, indexedEntries: 10, chinese: result.hits[0].messageId, english: english.hits[0].messageId,
    scope: "filtered before candidates", longQuery: "explicit fallback", clear: "keyword and sources retained" }));
  await call({ action: "close" }); await worker.terminate(); worker = null;
  await fs.rm(root, { recursive: true, force: true }); root = null;
  clearTimeout(timeout); app.exit(0);
}).catch(async (error) => {
  console.error(error);
  if (worker) await worker.terminate();
  if (root) await fs.rm(root, { recursive: true, force: true });
  clearTimeout(timeout); app.exit(1);
});
