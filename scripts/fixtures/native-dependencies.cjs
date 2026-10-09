const fs = require("node:fs");
const path = require("node:path");

function binary(platform, arch) {
  const bytes = Buffer.alloc(256);
  if (platform === "win32") {
    bytes.write("MZ", 0);
    bytes.writeUInt32LE(128, 60);
    bytes.write("PE\0\0", 128);
    bytes.writeUInt16LE(arch === "x64" ? 0x8664 : 0xaa64, 132);
  } else if (platform === "darwin") {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(arch === "x64" ? 0x01000007 : 0x0100000c, 4);
  } else {
    bytes.write("\x7fELF", 0);
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(arch === "x64" ? 62 : 183, 18);
  }
  return bytes;
}

function writeNativeFixture(root, platform, arch) {
  const files = {};
  const write = (file, content) => {
    files[file] = content;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const pkg = (name, nativeFiles = [], targeted = false) => {
    const base = `node_modules/${name}`;
    write(`${base}/package.json`, JSON.stringify({ name, version: "1.0.0", ...(targeted ? { os: [platform], cpu: [arch] } : {}) }));
    for (const file of nativeFiles) write(`${base}/${file}`, binary(platform, arch));
  };
  const suffix = platform === "win32" ? "-msvc" : platform === "linux" ? "-gnu" : "";
  pkg("@trycua/cua-driver");
  pkg(`@trycua/cua-driver-${platform}-${arch}${suffix}`, [
    platform === "win32" ? "cua_driver_sdk.dll" : `libcua_driver_sdk.${platform === "darwin" ? "dylib" : "so"}`,
    "cua_driver_node_runtime.node",
  ], true);
  pkg("@huggingface/transformers");
  pkg("sharp");
  pkg(`@img/sharp-${platform}-${arch}`, [
    `lib/sharp-${platform}-${arch}.node`,
    ...(platform === "win32" ? ["lib/libvips-42.dll", "lib/libvips-cpp-8.17.3.dll"] : []),
  ], true);
  if (platform !== "win32") pkg(`@img/sharp-libvips-${platform}-${arch}`, [
    platform === "darwin" ? "lib/libvips-cpp.8.17.3.dylib" : "lib/libvips-cpp.so.8.17.3",
  ], true);
  pkg("onnxruntime-node", [
    `bin/napi-v3/${platform}/${arch}/onnxruntime_binding.node`,
    ...(platform === "win32" ? ["onnxruntime.dll", "DirectML.dll"]
      : [platform === "darwin" ? "libonnxruntime.1.21.0.dylib" : "libonnxruntime.so.1.21.0"])
      .map((file) => `bin/napi-v3/${platform}/${arch}/${file}`),
  ]);
  pkg("node-pty", (platform === "win32" ? [
    "conpty.node", "conpty_console_list.node", "pty.node", "winpty-agent.exe",
    "winpty.dll", "conpty/conpty.dll", "conpty/OpenConsole.exe",
  ] : ["pty.node", "spawn-helper"]).map((file) => `prebuilds/${platform}-${arch}/${file}`));
  if (platform === "darwin") pkg("electron-liquid-glass", ["build/Release/liquidglass.node"], true);
  write("electron/dist/computer-use-mcp.js", "module.exports = 'fixture';");
  return files;
}

module.exports = { binary, writeNativeFixture };
