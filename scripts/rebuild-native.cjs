const fs = require("node:fs");
const path = require("node:path");

// node-pty ships Node-API binaries, but its custom prebuild layout is not
// recognized by electron-rebuild. Keep the helper EXEs/DLLs with the addons.
const WINDOWS_PTY_FILES = [
  "conpty.node",
  "conpty_console_list.node",
  "pty.node",
  "winpty-agent.exe",
  "winpty.dll",
  "conpty/conpty.dll",
  "conpty/OpenConsole.exe",
];

function getIgnoredModules({ buildPath, platform, arch, buildFromSource }) {
  const ignored = platform === "darwin" ? [] : ["electron-liquid-glass"];
  if (platform === "win32" && !buildFromSource) {
    const prebuildDir = path.join(buildPath, "node_modules/node-pty/prebuilds", `${platform}-${arch}`);
    const complete = WINDOWS_PTY_FILES.every((file) => {
      try {
        return fs.statSync(path.join(prebuildDir, file)).isFile();
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
        throw error;
      }
    });
    if (complete) ignored.push("node-pty");
  }
  return ignored;
}

async function rebuildNativeModules({
  buildPath = path.resolve(__dirname, ".."),
  electronVersion = require("electron/package.json").version,
  platform = process.platform,
  arch = process.arch,
  buildFromSource = false,
} = {}) {
  buildFromSource ||= process.env.npm_config_build_from_source === "true";
  const ignoreModules = getIgnoredModules({ buildPath, platform, arch, buildFromSource });
  if (ignoreModules.includes("electron-liquid-glass")) {
    console.log(`[native] Skipping macOS-only electron-liquid-glass on ${platform}`);
  }
  if (ignoreModules.includes("node-pty")) {
    console.log(`[native] Using bundled node-pty Node-API binaries for ${platform}-${arch}`);
  }

  // ignoreModules is an API option; electron-rebuild's CLI has no --ignore flag.
  const { rebuild } = await import("@electron/rebuild");
  const pending = rebuild({ buildPath, electronVersion, platform, arch, buildFromSource, ignoreModules });
  pending.lifecycle.on("module-found", (name) => {
    if (!ignoreModules.includes(name)) console.log(`[native] Preparing ${name}`);
  });
  await pending;
  console.log(`[native] Dependencies ready for Electron ${electronVersion} (${platform}-${arch})`);
}

module.exports = { getIgnoredModules, rebuildNativeModules };

if (require.main === module) {
  rebuildNativeModules().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
