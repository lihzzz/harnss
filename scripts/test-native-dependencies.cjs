const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { finished } = require("node:stream/promises");
const { test } = require("node:test");
const asar = require("@electron/asar");
const { checkNativeDependencies, binaryArchitectures } = require("./check-native-dependencies.cjs");
const { binary, writeNativeFixture } = require("./fixtures/native-dependencies.cjs");

function fixture(t, platform = "win32", arch = "x64") {
  const tempDir = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(tempDir, "harnss-native-check-"));
  const source = path.join(root, "source");
  t.after(() => {
    asar.uncacheAll();
    assert.equal(path.dirname(path.resolve(root)), tempDir);
    assert.ok(path.basename(root).startsWith("harnss-native-check-"));
    fs.rmSync(root, { recursive: true, force: true });
  });
  writeNativeFixture(source, platform, arch);
  return { source, options: { buildPath: source, platform, arch }, archive: path.join(root, "app.asar") };
}

for (const platform of ["win32", "darwin"]) {
  for (const arch of ["x64", "arm64"]) {
    test(`${platform}-${arch} requires complete native packages`, (t) => {
      const { options } = fixture(t, platform, arch);
      assert.ok(checkNativeDependencies(options).checkedFiles >= 8);
    });
  }
}

test("a host-only installation fails explicitly for the other CPU", (t) => {
  const { options } = fixture(t);
  assert.throws(() => checkNativeDependencies({ ...options, arch: "arm64" }), /Cua: Missing package @trycua\/cua-driver-win32-arm64-msvc/);
  assert.throws(() => checkNativeDependencies({ ...options, arch: "arm64" }), /Sharp: Missing package @img\/sharp-win32-arm64/);
});

test("package metadata cannot hide an incorrect native architecture", (t) => {
  const { options, source } = fixture(t);
  fs.writeFileSync(path.join(source, "node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll"), binary("win32", "arm64"));
  assert.throws(() => checkNativeDependencies(options), /expected x64, found arm64/);
});

test("a foreign OS binary is rejected even when the CPU matches", (t) => {
  const { options, source } = fixture(t);
  fs.writeFileSync(path.join(source, "node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll"), binary("darwin", "x64"));
  assert.throws(() => checkNativeDependencies(options), /expected win32, found darwin/);
});

test("a missing terminal helper is not accepted as a complete runtime", (t) => {
  const { options, source } = fixture(t);
  fs.unlinkSync(path.join(source, "node_modules/node-pty/prebuilds/win32-x64/conpty/OpenConsole.exe"));
  assert.throws(() => checkNativeDependencies(options), /No complete win32-x64 runtime/);
});

for (const dll of ["libvips-42.dll", "libvips-cpp-8.17.3.dll"]) {
  test(`Sharp requires ${dll} as well as its Node addon`, (t) => {
    const { options, source } = fixture(t);
    fs.unlinkSync(path.join(source, "node_modules/@img/sharp-win32-x64/lib", dll));
    assert.throws(() => checkNativeDependencies(options), /Sharp: Missing runtime/);
  });
}

test("an incomplete preferred macOS build cannot borrow a prebuilt spawn helper", (t) => {
  const { options, source } = fixture(t, "darwin", "arm64");
  const build = path.join(source, "node_modules/node-pty/build/Release");
  fs.mkdirSync(build, { recursive: true });
  fs.writeFileSync(path.join(build, "pty.node"), binary("darwin", "arm64"));
  assert.throws(() => checkNativeDependencies(options), /node-pty: Missing runtime file.*spawn-helper/);
});

test("pnpm package links resolve transitive dependencies from their real locations", (t) => {
  const { options, source } = fixture(t);
  const original = path.join(source, "node_modules/sharp");
  const nested = path.join(source, "node_modules/.pnpm/sharp-fixture/node_modules/sharp");
  assert.equal(path.relative(source, original), path.normalize("node_modules/sharp"));
  assert.equal(path.relative(source, nested), path.normalize("node_modules/.pnpm/sharp-fixture/node_modules/sharp"));
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.renameSync(original, nested);
  fs.symlinkSync(nested, original, process.platform === "win32" ? "junction" : "dir");
  assert.ok(checkNativeDependencies(options).checkedFiles > 0);
});

test("ASAR checks native files and their unpacked physical copies", async (t) => {
  const { options, source, archive } = fixture(t);
  await finished(await asar.createPackageWithOptions(source, archive, { unpackDir: "node_modules", unpack: "computer-use-mcp.js" }));
  assert.ok(checkNativeDependencies({ ...options, archive }).checkedFiles > 0);
  fs.unlinkSync(path.join(`${archive}.unpacked`, "node_modules/@trycua/cua-driver-win32-x64-msvc/cua_driver_sdk.dll"));
  assert.throws(() => checkNativeDependencies({ ...options, archive }), /Missing unpacked runtime/);
});

test("packed native addons fail even when the bytes are present in ASAR", async (t) => {
  const { options, source, archive } = fixture(t);
  await finished(await asar.createPackageWithOptions(source, archive, {}));
  assert.throws(() => checkNativeDependencies({ ...options, archive }), /Native runtime must be unpacked/);
});

test("universal Mach-O headers accept both CPUs without running foreign code", () => {
  const header = Buffer.alloc(48);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(0x01000007, 8);
  header.writeUInt32BE(0x0100000c, 28);
  assert.deepEqual(binaryArchitectures(header), ["x64", "arm64"]);
  assert.deepEqual(binaryArchitectures(Buffer.from("not an executable")), []);
});
