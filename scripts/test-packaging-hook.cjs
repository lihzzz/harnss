// Run: node --test scripts/test-packaging-hook.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const asar = require("@electron/asar");
const { afterPack } = require("../electron-builder.config.js");

async function fixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-packaging-"));
  try {
    const source = path.join(root, "source");
    const resources = path.join(root, "output/resources");
    const archive = path.join(resources, "app.asar");
    const files = {
      "package.json": '{"name":"packaging-test"}',
      "electron/dist/main.js": "module.exports = 'main';",
      "electron/dist/history-worker.js": "module.exports = 'history';",
      "dist/index.html": "<!doctype html><title>History</title>",
      "node_modules/onnxruntime-node/bin/runtime.dylib": "native-runtime-fixture",
      "logs/should-not-ship.log": "development-only",
    };
    for (const [file, content] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
      await fs.writeFile(path.join(source, file), content);
    }
    // In asar 3.4, creation resolves with the ending output stream.
    const stream = await asar.createPackageWithOptions(source, archive, { unpackDir: "node_modules/onnxruntime-node" });
    await finished(stream);
    await run({ archive, files, context: { appOutDir: path.join(root, "output"), electronPlatformName: "linux" } });
  } finally {
    asar.uncacheAll();
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("repacking preserves runtime bytes and native unpacking while refreshing cached offsets", async () => {
  await fixture(async ({ archive, files, context }) => {
    await afterPack(context);
    for (const [file, content] of Object.entries(files)) {
      if (!file.startsWith("logs/")) assert.equal(asar.extractFile(archive, file).toString(), content);
    }
    assert.ok(!asar.listPackage(archive).some((file) => file.includes("should-not-ship")));
    assert.equal(asar.statFile(archive, "node_modules/onnxruntime-node/bin/runtime.dylib").unpacked, true);
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
