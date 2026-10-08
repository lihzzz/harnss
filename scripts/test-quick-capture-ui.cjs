// Run: pnpm exec electron scripts/test-quick-capture-ui.cjs
// Isolated React/DOM checks; no supplier process, real clipboard, or user history.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "harnss-quick-capture-ui-"));
app.setPath("userData", profile);
app.commandLine.appendSwitch("use-mock-keychain");
const timeout = setTimeout(() => { console.error("Quick capture UI check timed out"); app.exit(1); }, 30_000);
app.once("quit", () => { clearTimeout(timeout); fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); });
app.whenReady().then(async () => {
  let exitCode = 1;
  try {
    session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_details, reply) => reply({ cancel: true }));
    const { build } = require(require.resolve("esbuild", { paths: [require.resolve("tsup")] }));
    await build({ entryPoints: [path.join(__dirname, "fixtures/quick-capture-ui.tsx")], outfile: path.join(profile, "fixture.js"),
      bundle: true, platform: "browser", format: "iife", tsconfig: path.join(root, "tsconfig.json"),
      define: { "process.env.NODE_ENV": '"development"', "import.meta.env.DEV": "false" } });
    fs.writeFileSync(path.join(profile, "index.html"), '<!doctype html><html><body><h1>Quick capture checks</h1><script src="fixture.js"></script></body></html>');
    const win = new BrowserWindow({ show: false, width: 900, height: 650, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.webContents.on("console-message", (event) => { if (event.level === "error") console.error("renderer:", event.message); });
    await win.loadFile(path.join(profile, "index.html"));
    for (const result of await win.webContents.executeJavaScript("window.runQuickCaptureChecks()", true)) console.log(`quick-capture-ui: ${result}`);
    exitCode = 0;
  } catch (error) { console.error(error); }
  finally { app.exit(exitCode); }
});
