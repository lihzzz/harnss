// Run: pnpm build && pnpm exec electron scripts/test-history-ui.cjs
// Uses only generated conversations in an isolated profile and a mock OS keychain.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const artifactRoot = process.argv[3] ? path.resolve(process.argv[3]) : root;
const output = path.join(root, ".cache/productivity");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-history-ui-"));
const dataRoot = path.join(profile, "openacpui-data");
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(dataRoot, { recursive: true });
app.once("quit", () => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }));
const semanticCache = process.argv[2];
if (semanticCache) fs.cpSync(path.resolve(semanticCache), path.join(dataRoot, "history/models"), { recursive: true });
app.setPath("userData", profile);
app.commandLine.appendSwitch("use-mock-keychain");
Object.defineProperty(app, "isPackaged", { get: () => true });
const write = (file, value) => fs.writeFileSync(path.join(dataRoot, file), JSON.stringify(value));
write("settings.json", { analyticsEnabled: false, memory: { enabled: false }, globalShortcuts: { enabled: false }, voiceDictation: "disabled" });
const projects = [{ id: "p1", name: "History One", path: path.join(profile, "project1"), createdAt: 1 },
  { id: "p2", name: "History Two", path: path.join(profile, "project2"), createdAt: 2, spaceId: "personal" }];
for (const project of projects) { fs.mkdirSync(project.path, { recursive: true }); fs.mkdirSync(path.join(dataRoot, "sessions", project.id), { recursive: true }); }
write("projects.json", projects);
write("spaces.json", [{ id: "default", name: "Work", icon: "⭐", iconType: "emoji", color: { hue: 200, chroma: .1 }, createdAt: 1, order: 0 },
  { id: "personal", name: "Personal", icon: "🌱", iconType: "emoji", color: { hue: 140, chroma: .1 }, createdAt: 2, order: 1 }]);
const now = Date.now();
for (const project of projects) write(`sessions/${project.id}/chat-${project.id}.json`, { id: `chat-${project.id}`, conversationId: `conversation-${project.id}`, projectId: project.id, title: `History ${project.id}`, createdAt: now - 5000,
  engine: "claude", archived: project.id === "p2", messages: [
    { id: `user-${project.id}`, role: "user", content: `搜索 all projects ${project.name}`, timestamp: now - 4000 },
    { id: `tool1-${project.id}`, role: "tool_call", content: "", toolName: "Bash", toolInput: { command: "echo first" }, toolResult: { content: "first" }, timestamp: now - 3000 },
    { id: `tool2-${project.id}`, role: "tool_call", content: "", toolName: "Bash", toolInput: { command: "echo second" }, toolResult: { content: "second" }, timestamp: now - 2000 },
    { id: `assistant-${project.id}`, role: "assistant", content: "Saved response from the original conversation.", timestamp: now - 1000 },
  ] });
const legacyAlias = JSON.parse(fs.readFileSync(path.join(dataRoot, "sessions/p2/chat-p2.json"), "utf8"));
legacyAlias.id = "legacy-p2";
legacyAlias.messages[0].timestamp--;
write("sessions/p2/legacy-p2.json", legacyAlias);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let started = false;
const timeout = setTimeout(() => { console.error("UI check timed out"); app.exit(1); }, 60_000);
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (event) => { console.error("renderer:", event.level, event.message.slice(0, 600)); });
  contents.on("did-finish-load", async () => {
    if (!contents.getURL().includes("dist/index.html") || started) return;
    started = true;
    const run = (js) => contents.executeJavaScript(js, true).catch((error) => { console.error("Failed expression:", js); throw error; });
    const wait = async (js) => { for (let i = 0; i < 160; i++) { if (await run(js)) return; await sleep(50); } throw new Error(`Not ready: ${js}`); };
    try {
      await run('localStorage.clear(); localStorage.setItem("harnss-welcome-completed", "true"); localStorage.setItem("harnss-settings-store", JSON.stringify({state:{language:"en-US",theme:"dark"},version:0}));');
      contents.reload();
      await new Promise((resolve) => contents.once("did-finish-load", resolve));
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Search all conversations"))');
      await run('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Search all conversations")).click()');
      await wait(`!!document.querySelector('input[aria-label="Search all conversation history"]')`);
      await run(`const input=document.querySelector('input[aria-label="Search all conversation history"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,"搜索"); input.dispatchEvent(new Event("input",{bubbles:true}));`);
      await wait('document.querySelectorAll("[role=listitem]").length===2');
      await sleep(300);
      await fs.promises.writeFile(path.join(output, "history-search.png"), (await contents.capturePage()).toPNG());
      await run('[...document.querySelectorAll("[role=listitem] button")].find(b=>b.textContent.includes("History Two")).click()');
      await wait('!document.querySelector("[role=dialog]") && !!document.querySelector("[data-message-id=user-p2]")');
      console.log("history-ui: cross-space archived source opened");
      await run('document.querySelector("button[aria-label=Activity]").click()');
      await wait(`document.querySelectorAll('[aria-label="Activity calendar"] button').length>300`);
      await wait('[...document.querySelectorAll("[role=listitem] button")].some(b=>b.textContent.includes("Tool"))');
      await sleep(300);
      await fs.promises.writeFile(path.join(output, "history-activity.png"), (await contents.capturePage()).toPNG());
      await run('[...document.querySelectorAll("[role=listitem] button")].find(b=>b.textContent.includes("Tool")&&b.textContent.includes("History Two")).click()');
      await wait('!document.querySelector("[role=dialog]") && !!document.querySelector("[data-message-id=tool2-p2]")');
      console.log("history-ui: grouped tool source revealed");
      const archived = await run('window.claude.sessions.list("p2").then(items=>items[0].archived)');
      if (!archived) throw new Error("Opening history changed archive state");
      const replaced = await run(`(async()=>{
        const source = await window.claude.sessions.load("p2","chat-p2");
        if (!source) throw new Error("Replacement fixture is missing");
        const result = await window.claude.sessions.save({...source,id:"chat-p2-resumed",conversationId:"conversation-p2-remapped"},"chat-p2");
        if (result.error) throw new Error(result.error);
        return {late:await window.claude.sessions.save(source),old:await window.claude.sessions.load("p2","chat-p2"),current:await window.claude.sessions.list("p2")};
      })()`);
      if (replaced.late.code !== "SESSION_REPLACED" || replaced.old !== null || replaced.current.length !== 1
        || replaced.current[0].id !== "chat-p2-resumed" || !replaced.current[0].archived) throw new Error("Runtime replacement did not preserve one authoritative archived source");
      await wait('window.claude.history.search({requestId:crypto.randomUUID(),scope:{kind:"all"},engines:[],includeArchived:true,query:"History Two",mode:"keyword",sort:"recent",limit:30,cursor:null,from:null,to:null}).then(r=>r.ok&&r.value.hits.length===1&&r.value.hits[0].runtimeSessionId==="chat-p2-resumed")');
      const legacyWrite = await run('window.claude.sessions.save({id:"legacy-p2",projectId:"p2",conversationId:"forged-alias",title:"Late legacy",createdAt:1,totalCost:0,messages:[]})');
      if (legacyWrite.code !== "SESSION_REPLACED") throw new Error("A legacy alias bypassed runtime retirement");
      const identityUpdate = await run(`(async()=>{
        const source = await window.claude.sessions.load("p2","chat-p2-resumed");
        const saved = await window.claude.sessions.save({...source,conversationId:"conversation-p2-promoted"});
        return {saved,late:await window.claude.sessions.save(source),current:await window.claude.sessions.load("p2","chat-p2-resumed")};
      })()`);
      if (identityUpdate.saved.error || identityUpdate.late.code !== "SESSION_REPLACED" || !identityUpdate.current.archived
        || identityUpdate.current.conversationId !== "conversation-p2-promoted") throw new Error("In-place identity promotion did not preserve the source or reject stale writes");
      await wait('window.claude.history.search({requestId:crypto.randomUUID(),scope:{kind:"all"},engines:[],includeArchived:true,query:"History Two",mode:"keyword",sort:"recent",limit:30,cursor:null,from:null,to:null}).then(r=>r.ok&&r.value.hits.length===1&&r.value.hits[0].conversationKey===JSON.stringify(["p2","claude","conversation-p2-promoted"]))');
      contents.reload(); await new Promise((resolve) => contents.once("did-finish-load", resolve));
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("Search all conversations"))');
      console.log("history-ui: committed runtime replacement rejects late writes, preserves archive state and remaps history");
      console.log("history-ui: legacy aliases and in-place identity changes retain one current source across renderer reload");
      if (semanticCache) {
        const openSettings = async () => {
          await run('document.querySelector("button:has(>svg.lucide-settings)").click()');
          await wait('[...document.querySelectorAll("nav button")].some(b=>b.textContent.trim()==="Conversation history")');
          await run('[...document.querySelectorAll("nav button")].find(b=>b.textContent.trim()==="Conversation history").click()');
          await wait('!!document.querySelector("input[aria-label=\\"Enable semantic search\\"]")');
        };
        await openSettings();
        await run('document.querySelector("input[aria-label=\\"Enable semantic search\\"]").click()');
        await wait('window.claude.history.status().then(r=>r.ok&&r.value.semanticState==="ready"&&r.value.coverage.semanticComplete)');
        await sleep(300);
        await fs.promises.writeFile(path.join(output, "history-settings.png"), (await contents.capturePage()).toPNG());
        await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
        await run('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Search all conversations")).click()');
        await wait(`!!document.querySelector('input[aria-label="Search all conversation history"]')`);
        await run(`const semanticInput=document.querySelector('input[aria-label="Search all conversation history"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(semanticInput,"find saved conversations across projects"); semanticInput.dispatchEvent(new Event("input",{bubbles:true}));`);
        await run('const select=[...document.querySelectorAll("label")].find(l=>l.textContent.startsWith("Search mode")).querySelector("select"); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(select,"semantic"); select.dispatchEvent(new Event("change",{bubbles:true}));');
        await wait('document.body.innerText.includes("Ranked results, up to") && document.querySelectorAll("[role=listitem]").length>0');
        await sleep(300);
        await fs.promises.writeFile(path.join(output, "history-semantic.png"), (await contents.capturePage()).toPNG());
        await run('document.querySelector("[role=listitem] button").click()');
        await wait('!document.querySelector("[role=dialog]")');
        await openSettings();
        await run('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Clear semantic cache").click()');
        await wait('!document.querySelector("input[aria-label=\\"Enable semantic search\\"]").checked');
        const settings = await run('window.claude.settings.get()');
        if (settings.history.semanticEnabled) throw new Error("Clearing the semantic cache did not disable the setting");
        console.log("history-ui: local semantic settings, ranked results and cache clearing passed");
      }
      await run('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
      const unlink = fs.promises.unlink;
      fs.promises.unlink = async (file) => {
        if (String(file) === path.join(dataRoot, "sessions/p1/chat-p1.meta.json")) throw Object.assign(new Error("Fixture file is locked"), { code: "EACCES" });
        return unlink(file);
      };
      try {
        const deletion = await run('window.claude.sessions.batch.start({requestId:crypto.randomUUID(),action:"delete",targets:[{projectId:"p1",conversationKey:JSON.stringify(["p1","claude","conversation-p1"])}]})');
        if (!deletion.ok) throw new Error(deletion.error.message);
        await wait(`window.claude.sessions.batch.status(${JSON.stringify(deletion.value.jobId)}).then(r=>r.ok&&r.value.completedAt!==null&&r.value.items[0].error?.code==="DELETE_INCOMPLETE")`);
        if (await run('window.claude.sessions.load("p1","chat-p1")')) throw new Error("Partially deleted source was still available");
        // Reload loses renderer state and session rows; the durable intent must
        // still provide a retry entry, including when no source file remains.
        contents.reload();
        await new Promise((resolve) => contents.once("did-finish-load", resolve));
        await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="Retry failed")');
      } finally { fs.promises.unlink = unlink; }
      await sleep(300);
      await fs.promises.writeFile(path.join(output, "batch-delete-recovery.png"), (await contents.capturePage()).toPNG());
      await run('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Retry failed").click()');
      await wait('window.claude.sessions.batch.recoveries().then(r=>r.ok&&r.value.length===0)');
      const again = await run('window.claude.sessions.batch.start({requestId:crypto.randomUUID(),action:"delete",targets:[{projectId:"p1",conversationKey:JSON.stringify(["p1","claude","conversation-p1"])}]})');
      if (!again.ok) throw new Error(again.error.message);
      await wait(`window.claude.sessions.batch.status(${JSON.stringify(again.value.jobId)}).then(r=>r.ok&&r.value.items[0].state==="skipped"&&r.value.items[0].error?.code==="ALREADY_DELETED")`);
      console.log("history-ui: partial deletion, recovery after renderer reload, retry and already-deleted result passed");
      await run('[...document.querySelectorAll("button")].find(b=>b.textContent.includes("Search all conversations")).click()');
      await wait(`!!document.querySelector('input[aria-label="Search all conversation history"]')`);
      await run(`const projectInput=document.querySelector('input[aria-label="Search all conversation history"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(projectInput,"Saved response"); projectInput.dispatchEvent(new Event("input",{bubbles:true}));`);
      await wait('[...document.querySelectorAll("[role=listitem] button")].some(b=>b.textContent.includes("History Two"))');
      await run('[...document.querySelectorAll("[role=listitem] button")].find(b=>b.textContent.includes("History Two")).click()');
      await wait('!!document.querySelector("[data-message-id=assistant-p2]") && !!document.querySelector("[data-project-drop-anchor-id=p2]")');
      const deleteProjectInUI = async () => {
        await run('[...document.querySelectorAll("[data-project-drop-anchor-id=p2] button")].at(-1).click()');
        await wait('[...document.querySelectorAll("[role=menuitem]")].some(item=>item.textContent.trim()==="Delete")');
        await run('[...document.querySelectorAll("[role=menuitem]")].find(item=>item.textContent.trim()==="Delete").click()');
      };
      const removeDirectory = fs.promises.rm;
      fs.promises.rm = async (file, options) => {
        if (String(file) === path.join(dataRoot, "sessions/p2")) throw new Error("Fixture project directory is locked");
        return removeDirectory(file, options);
      };
      try {
        await deleteProjectInUI();
        await wait('document.body.innerText.includes("Project deletion is incomplete")');
        if (!await run('!!document.querySelector("[data-project-drop-anchor-id=p2]")')) throw new Error("Failed project deletion removed its retry entry");
        await wait('window.claude.history.search({requestId:crypto.randomUUID(),scope:{kind:"all"},engines:[],includeArchived:true,query:"Saved response",mode:"keyword",sort:"recent",limit:30,cursor:null,from:null,to:null}).then(r=>r.ok&&r.value.hits.length===0)');
        console.log("history-ui: failed project deletion retains its retry entry and immediately excludes history");
      } finally { fs.promises.rm = removeDirectory; }
      await deleteProjectInUI();
      await wait('!document.querySelector("[data-project-drop-anchor-id=p2]") && !document.querySelector("[data-message-id=assistant-p2]")');
      const lateWrite = await run('window.claude.sessions.save({id:"late-after-project-delete",projectId:"p2",title:"Late fixture",createdAt:1,totalCost:0,messages:[]})');
      if (!lateWrite.error?.includes("PROJECT_DELETED")) throw new Error("Late save recreated a deleted project");
      if (!fs.existsSync(projects[1].path)) throw new Error("Project deletion removed the working directory");
      if (fs.existsSync(path.join(dataRoot, "sessions/p2"))) throw new Error("Deleted project still has source snapshots");
      contents.reload(); await new Promise((resolve) => contents.once("did-finish-load", resolve));
      await wait('window.claude.projects.list().then(items=>items.length===1&&items[0].id==="p1")');
      console.log("history-ui: project deletion retry clears the active pane, rejects late writes and survives reload");
      console.log("history-ui: passed, archive state preserved");
      clearTimeout(timeout); app.quit();
    } catch (error) {
      console.error(error);
      console.error("history status:", await run('window.claude.history.status()'));
      console.error((await run('document.body.innerText')).slice(0, 6000));
      await fs.promises.writeFile(path.join(output, "history-ui-failed.png"), (await contents.capturePage()).toPNG());
      clearTimeout(timeout); app.exit(1);
    }
  });
});
require(path.join(artifactRoot, "electron/dist/main.js"));
