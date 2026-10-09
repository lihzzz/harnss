const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { parseArgs } = require("node:util");

const WINDOWS_PTY_FILES = [
  "conpty.node", "conpty_console_list.node", "pty.node", "winpty-agent.exe",
  "winpty.dll", "conpty/conpty.dll", "conpty/OpenConsole.exe",
];

// Inspect headers without executing a binary built for another architecture.
function binaryArchitectures(header) {
  if (header.length < 32) return [];
  if (header.toString("ascii", 0, 2) === "MZ" && header.length >= 64) {
    const pe = header.readUInt32LE(60);
    if (pe + 6 > header.length || header.toString("ascii", pe, pe + 4) !== "PE\0\0") return [];
    return ({ 0x8664: ["x64"], 0xaa64: ["arm64"] })[header.readUInt16LE(pe + 4)] ?? [];
  }
  if (header.toString("hex", 0, 4) === "7f454c46") {
    const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
    return ({ 62: ["x64"], 183: ["arm64"] })[machine] ?? [];
  }
  const cpu = (value) => ({ 0x01000007: "x64", 0x0100000c: "arm64" })[value];
  const magic = header.readUInt32BE(0);
  if (magic === 0xcffaedfe) return [cpu(header.readUInt32LE(4))].filter(Boolean);
  if (magic === 0xfeedfacf) return [cpu(header.readUInt32BE(4))].filter(Boolean);
  if (magic === 0xcafebabe || magic === 0xcafebabf) {
    const count = header.readUInt32BE(4);
    const stride = magic === 0xcafebabf ? 32 : 20;
    if (8 + count * stride > header.length) return [];
    return Array.from({ length: count }, (_, index) => cpu(header.readUInt32BE(8 + index * stride))).filter(Boolean);
  }
  return [];
}

function readHeader(file) {
  const descriptor = fs.openSync(file, "r");
  try {
    const header = Buffer.alloc(4096);
    return header.subarray(0, fs.readSync(descriptor, header, 0, header.length, 0));
  } finally { fs.closeSync(descriptor); }
}

function binaryPlatform(header) {
  if (header.length < 4) return undefined;
  if (header.toString("ascii", 0, 2) === "MZ") return "win32";
  if (header.toString("hex", 0, 4) === "7f454c46") return "linux";
  if ([0xcffaedfe, 0xfeedfacf, 0xcafebabe, 0xcafebabf].includes(header.readUInt32BE(0))) return "darwin";
  return undefined;
}

function isFile(file) {
  try { return fs.statSync(file).isFile(); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

function installedView(buildPath) {
  return {
    root: path.resolve(buildPath),
    join: path.join,
    file: isFile,
    json: (file) => JSON.parse(fs.readFileSync(file, "utf8")),
    list: (directory) => fs.readdirSync(directory),
    nativeFile: (file) => file,
    findPackage(name, from = this.root) {
      const requireFrom = createRequire(path.join(fs.realpathSync(from), "package.json"));
      for (const directory of requireFrom.resolve.paths(name) ?? []) {
        const candidate = path.join(directory, name);
        if (isFile(path.join(candidate, "package.json"))) return fs.realpathSync(candidate);
      }
      throw new Error(`Missing package ${name}`);
    },
  };
}

function archiveView(archive) {
  const asar = require("@electron/asar");
  asar.uncache(archive);
  const entries = new Map(asar.listPackage(archive).map((entry) => {
    const relative = entry.replace(/^[/\\]/, "").replaceAll("\\", "/");
    return [relative, asar.statFile(archive, path.normalize(relative))];
  }));
  return {
    root: "",
    join: path.posix.join,
    file: (file) => entries.has(file) && !entries.get(file).files,
    json: (file) => JSON.parse(asar.extractFile(archive, path.normalize(file)).toString("utf8")),
    list: (directory) => Object.keys(entries.get(directory)?.files ?? {}),
    nativeFile(file) {
      if (!entries.get(file)?.unpacked) throw new Error(`Native runtime must be unpacked: ${file}`);
      const physicalFile = path.join(`${archive}.unpacked`, file);
      if (!isFile(physicalFile)) throw new Error(`Missing unpacked runtime: ${file}`);
      return physicalFile;
    },
    findPackage(name, from = "") {
      let directory = from;
      while (true) {
        const candidate = path.posix.join(directory, "node_modules", name);
        if (this.file(path.posix.join(candidate, "package.json"))) return candidate;
        if (!directory || directory === ".") break;
        const parent = path.posix.dirname(directory);
        directory = parent === "." ? "" : parent;
      }
      throw new Error(`Missing package ${name} in ASAR`);
    },
  };
}

function checkNativeDependencies({
  buildPath = path.resolve(__dirname, ".."), platform = process.platform,
  arch = process.arch, archive,
} = {}) {
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)) {
    throw new Error(`Unsupported native target ${platform}-${arch}; expected win32/darwin/linux and x64/arm64`);
  }
  const view = archive ? archiveView(path.resolve(archive)) : installedView(buildPath);
  const errors = [];
  const checked = [];
  const run = (label, fn) => {
    try { fn(); } catch (error) { errors.push(`${label}: ${error.message}`); }
  };
  const packageRoot = (name, from) => {
    const root = view.findPackage(name, from);
    const metadata = view.json(view.join(root, "package.json"));
    if (metadata.os && !metadata.os.includes(platform)) throw new Error(`${name} does not support ${platform}`);
    if (metadata.cpu && !metadata.cpu.includes(arch)) throw new Error(`${name} does not support ${arch}`);
    return root;
  };
  const native = (file) => {
    if (!view.file(file)) throw new Error(`Missing runtime file ${file}`);
    const header = readHeader(view.nativeFile(file));
    if (binaryPlatform(header) !== platform) throw new Error(`Wrong or invalid binary platform for ${file}: expected ${platform}, found ${binaryPlatform(header) ?? "unknown"}`);
    const actual = binaryArchitectures(header);
    if (!actual.includes(arch)) throw new Error(`Wrong or invalid binary architecture for ${file}: expected ${arch}, found ${actual.join(",") || "unknown"}`);
    checked.push(file);
  };
  const matchingNative = (directory, pattern) => {
    const files = view.list(directory).filter((name) => pattern.test(name));
    if (!files.length) throw new Error(`Missing runtime matching ${pattern} in ${directory}`);
    for (const file of files) native(view.join(directory, file));
  };

  run("Cua", () => {
    const driver = packageRoot("@trycua/cua-driver");
    const suffix = platform === "win32" ? "-msvc" : platform === "linux" ? "-gnu" : "";
    const binary = packageRoot(`@trycua/cua-driver-${platform}-${arch}${suffix}`, driver);
    native(view.join(binary, platform === "win32" ? "cua_driver_sdk.dll" : `libcua_driver_sdk.${platform === "darwin" ? "dylib" : "so"}`));
    native(view.join(binary, "cua_driver_node_runtime.node"));
    if (archive) {
      const helper = "electron/dist/computer-use-mcp.js";
      if (!view.file(helper)) throw new Error(`Missing runtime file ${helper}`);
      view.nativeFile(helper);
    }
  });
  run("Sharp", () => {
    const transformers = packageRoot("@huggingface/transformers");
    const sharp = packageRoot("sharp", transformers);
    const binary = packageRoot(`@img/sharp-${platform}-${arch}`, sharp);
    native(view.join(binary, "lib", `sharp-${platform}-${arch}.node`));
    if (platform === "win32") {
      native(view.join(binary, "lib", "libvips-42.dll"));
      matchingNative(view.join(binary, "lib"), /^libvips-cpp-.*\.dll$/);
    }
    else {
      const vips = packageRoot(`@img/sharp-libvips-${platform}-${arch}`, sharp);
      matchingNative(view.join(vips, "lib"), platform === "darwin" ? /^libvips.*\.dylib$/ : /^libvips.*\.so(?:\..*)?$/);
    }
  });
  run("ONNX", () => {
    const transformers = packageRoot("@huggingface/transformers");
    const onnx = packageRoot("onnxruntime-node", transformers);
    const directory = view.join(onnx, "bin", "napi-v3", platform, arch);
    native(view.join(directory, "onnxruntime_binding.node"));
    if (platform === "win32") {
      native(view.join(directory, "onnxruntime.dll"));
      native(view.join(directory, "DirectML.dll"));
    } else matchingNative(directory, platform === "darwin" ? /^libonnxruntime.*\.dylib$/ : /^libonnxruntime\.so(?:\..*)?$/);
  });
  run("node-pty", () => {
    const pty = packageRoot("node-pty");
    const files = platform === "win32" ? WINDOWS_PTY_FILES : ["pty.node", "spawn-helper"];
    const attempts = [];
    for (const candidate of ["build/Release", "build/Debug", `prebuilds/${platform}-${arch}`]) {
      if (platform !== "win32") {
        // node-pty chooses the first loadable addon, then executes the helper
        // from that same directory. A helper in a later prebuild is not enough.
        try { native(view.join(pty, candidate, "pty.node")); }
        catch (error) { attempts.push(error.message); continue; }
        native(view.join(pty, candidate, "spawn-helper"));
        return;
      }
      try {
        for (const file of files) native(view.join(pty, candidate, file));
        return;
      } catch (error) { attempts.push(error.message); }
    }
    throw new Error(`No complete ${platform}-${arch} runtime; ${attempts.join("; ")}`);
  });
  if (platform === "darwin") run("Liquid Glass", () => {
    const glass = packageRoot("electron-liquid-glass");
    const filename = arch === "arm64" ? "node.napi.armv8.node" : "node.napi.node";
    const prebuild = view.join(glass, "prebuilds", `darwin-${arch}`, filename);
    native(view.file(prebuild) ? prebuild : view.join(glass, "build", "Release", "liquidglass.node"));
  });
  if (errors.length) {
    throw new Error(`Native dependencies are incomplete for ${platform}-${arch}${archive ? " in ASAR" : ""}:\n- ${errors.join("\n- ")}\nRun pnpm install --frozen-lockfile on the target OS to prepare both configured CPUs, then rebuild. A file check does not replace target-machine runtime tests.`);
  }
  return { platform, arch, archive: archive ?? null, checkedFiles: [...new Set(checked)].length };
}

module.exports = { binaryArchitectures, checkNativeDependencies };

if (require.main === module) {
  try {
    const { values } = parseArgs({ options: {
      platform: { type: "string" }, arch: { type: "string" },
      root: { type: "string" }, archive: { type: "string" },
    } });
    console.log(JSON.stringify(checkNativeDependencies({
      buildPath: values.root, platform: values.platform, arch: values.arch, archive: values.archive,
    }), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
