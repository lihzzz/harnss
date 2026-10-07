// Run: pnpm build && pnpm exec electron scripts/test-whisper-runtime.cjs /absolute/path/sample.wav
// Uses the built browser worker in an isolated Electron profile. It never opens the user's Harnss data.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const profile = path.join(root, ".cache/productivity/voice-smoke");
fs.mkdirSync(profile, { recursive: true });
app.setPath("userData", profile);
app.commandLine.appendSwitch("disable-gpu");
const assets = path.join(root, "dist/assets");
const workerFile = fs.readdirSync(assets).find((name) => /^whisper\.worker-.*\.js$/.test(name));
if (!workerFile) throw new Error("Build the renderer before running this check");
const { pathToFileURL } = require("node:url");
const workerUrl = pathToFileURL(path.join(assets, workerFile)).href;
const audioPath = process.argv[2];
const audio = audioPath ? fs.readFileSync(audioPath).toString("base64") : null;
const fixture = path.join(profile, "voice-smoke.html");
fs.writeFileSync(fixture, "<!doctype html><meta charset=utf-8><title>Harnss speech runtime check</title><p>Isolated speech runtime check</p>");
const timeout = setTimeout(() => { console.error("Speech runtime check timed out"); app.exit(1); }, 8 * 60_000);

app.whenReady().then(async () => {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) await session.defaultSession.setProxy({ proxyRules: proxy, proxyBypassRules: "localhost;127.0.0.1" });
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.on("console-message", (event) => { if (event.message.startsWith("speech-check:")) console.log(event.message); });
  await window.loadFile(fixture);
  const result = await window.webContents.executeJavaScript(`(async () => {
    const worker = new Worker(${JSON.stringify(workerUrl)}, { type: "module" });
    const start = performance.now();
    let lastProgress = -1;
    const prepared = new Promise((resolve, reject) => {
      worker.onerror = (event) => reject(new Error(event.message));
      worker.onmessage = (event) => {
        if (event.data.type === "error") reject(new Error(event.data.message));
        if (event.data.type === "ready") resolve();
        if (event.data.type === "progress") {
          const percent = Math.floor(event.data.progress / 25) * 25;
          if (percent !== lastProgress) { lastProgress = percent; console.log("speech-check: loading " + percent + "%"); }
        }
      };
      worker.postMessage({ id: "prepare", type: "prepare" });
    });
    await prepared;
    const readyMs = performance.now() - start;
    let samples = new Float32Array(16000);
    let duration = 1;
    const encoded = ${JSON.stringify(audio)};
    if (encoded) {
      const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
      const context = new AudioContext({ sampleRate: 16000 });
      const decoded = await context.decodeAudioData(bytes.buffer);
      samples = Float32Array.from(decoded.getChannelData(0));
      duration = decoded.duration;
      await context.close();
    }
    const inferenceStart = performance.now();
    const text = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => {
        if (event.data.type === "result") resolve(event.data.text);
        if (event.data.type === "error") reject(new Error(event.data.message));
      };
      worker.postMessage({ id: "transcribe", type: "transcribe", audio: samples }, [samples.buffer]);
    });
    worker.terminate();
    return { readyMs, inferenceMs: performance.now() - inferenceStart, duration, text };
  })()`);
  console.log(JSON.stringify({ electron: process.versions.electron, platform: process.platform, arch: process.arch, ...result }));
  clearTimeout(timeout);
  app.exit(0);
}).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
