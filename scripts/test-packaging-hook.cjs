// Run: node --test scripts/test-packaging-hook.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const asar = require("@electron/asar");
const { afterPack } = require("../electron-builder.config.js");
const { Arch } = require("electron-builder");
const { writeNativeFixture } = require("./fixtures/native-dependencies.cjs");

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-packaging-"));
  try {
    const source = path.join(root, "source");
    const resources = path.join(root, "output", "resources");
    const archive = path.join(resources, "app.asar");
    const files = {
      ...writeNativeFixture(source, "win32", "x64"),
      "package.json": '{"name":"packaging-test"}',
      "electron/dist/main.js": "module.exports = 'main';",
      "electron/dist/history-worker.js": "module.exports = 'history';",
      "dist/index.html": "<!doctype html><title>History</title>",
      "node_modules/onnxruntime-node/bin/runtime.dylib": "native-runtime-fixture",
      "node_modules/onnxruntime-node/bin/runtime.dll": Buffer.from([0, 77, 90, 255, 128, 17]),
      "node_modules/onnxruntime-node/bin/helper.exe": Buffer.from([77, 90, 0, 254, 129, 23]),
      "node_modules/onnxruntime-node/package.json": '{"name":"onnxruntime-node"}',
      "node_modules/onnxruntime-node/lib/index.js": "module.exports = 'native-loader';",
      "node_modules/node-pty/bin/conpty.node": Buffer.from([0, 128, 255, 42]),
      "node_modules/node-pty/bin/helper.exe": Buffer.from([77, 90, 255, 0, 24]),
      "node_modules/node-pty/package.json": '{"name":"node-pty"}',
      "logs/should-not-ship.log": "development-only",
    };
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
      await fs.writeFile(path.join(source, file), content);
    }
    // In asar 3.4, creation resolves with the ending output stream.
    const stream = await asar.createPackageWithOptions(source, archive, {
      unpackDir: "node_modules",
      unpack: "computer-use-mcp.js",
    });
    await finished(stream);
    await run({ archive, files, context: {
      appOutDir: path.join(root, "output"), electronPlatformName: "win32",
      arch: Arch.x64, packager: { platform: { nodeName: "win32" } },
    } });
  } finally {
    asar.uncacheAll();
    const resolvedRoot = path.resolve(root);
    assert.equal(path.dirname(resolvedRoot), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedRoot).startsWith("harnss-packaging-"));
    await fs.rm(resolvedRoot, { recursive: true, force: true });
  }
}

test("repacking preserves runtime bytes and native unpacking while refreshing cached offsets", async () => {
  await fixture(async ({ archive, files, context }) => {
    await afterPack(context);
    for (const [file, content] of Object.entries(files)) {
      if (!file.startsWith("logs/")) {
        assert.deepEqual(asar.extractFile(archive, path.normalize(file)), Buffer.from(content), file);
      }
      if (file.startsWith("node_modules/")) {
        assert.equal(asar.statFile(archive, path.normalize(file)).unpacked, true, file);
        assert.deepEqual(await fs.readFile(path.join(`${archive}.unpacked`, file)), Buffer.from(content), file);
      }
    }
    assert.ok(!asar.listPackage(archive).some((file) => file.includes("should-not-ship")));
    for (const nativePackage of ["onnxruntime-node", "node-pty"]) {
      assert.equal(asar.statFile(archive, path.join("node_modules", nativePackage)).unpacked, true);
    }
  });
});

test("repacking rejects damaged archive content before computing new hashes", async () => {
  await fixture(async ({ archive, context }) => {
    const entry = asar.statFile(archive, "package.json");
    const offset = 8 + asar.getRawHeader(archive).headerSize + Number(entry.offset);
    const file = await fs.open(archive, "r+");
    try { await file.write(Buffer.from("X"), 0, 1, offset); } finally { await file.close(); }
    await assert.rejects(afterPack(context), /ASAR integrity mismatch: package\.json/);
  });
});
