const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const vm = require("node:vm");
const { getIgnoredModules } = require("./rebuild-native.cjs");

// Include the helper executables and DLLs: loading the addon alone does not
// establish that either the ConPTY or legacy WinPTY terminal can start.
const WINDOWS_RUNTIME_FILES = [
  "conpty.node",
  "conpty_console_list.node",
  "pty.node",
  "winpty-agent.exe",
  "winpty.dll",
  "conpty/conpty.dll",
  "conpty/OpenConsole.exe",
];

function fixture(t, prebuilds) {
  const tempDir = path.resolve(os.tmpdir());
  const prefix = "harnss-native-rebuild-test-";
  const root = fs.mkdtempSync(path.join(tempDir, prefix));
  t.after(() => {
    const resolvedRoot = path.resolve(root);
    assert.equal(path.dirname(resolvedRoot), tempDir);
    assert.ok(path.basename(resolvedRoot).startsWith(prefix));
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  });

  const packageDir = path.join(root, "node_modules", "node-pty");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "node-pty", version: "1.1.0", main: "lib/index.js" }),
  );
  for (const [target, files] of Object.entries(prebuilds)) {
    for (const relativeFile of files) {
      const file = path.join(packageDir, "prebuilds", target, relativeFile);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "fixture");
    }
  }
  return root;
}

function ignored(buildPath, overrides = {}) {
  return getIgnoredModules({
    buildPath,
    platform: "win32",
    arch: "x64",
    buildFromSource: false,
    ...overrides,
  }).slice().sort();
}

for (const arch of ["x64", "arm64"]) {
  test(`Windows ${arch} uses a complete bundled terminal runtime`, (t) => {
    const root = fixture(t, { [`win32-${arch}`]: WINDOWS_RUNTIME_FILES });
    assert.deepEqual(ignored(root, { arch }), ["electron-liquid-glass", "node-pty"]);
  });

  test(`Windows ${arch} honors an explicit source build`, (t) => {
    const root = fixture(t, { [`win32-${arch}`]: WINDOWS_RUNTIME_FILES });
    assert.deepEqual(ignored(root, { arch, buildFromSource: true }), ["electron-liquid-glass"]);
  });
}

test("an incomplete Windows runtime falls back to rebuilding", async (t) => {
  for (const missing of WINDOWS_RUNTIME_FILES) {
    await t.test(`missing ${missing}`, (t) => {
      const root = fixture(t, {
        "win32-x64": WINDOWS_RUNTIME_FILES.filter((file) => file !== missing),
      });
      assert.deepEqual(ignored(root), ["electron-liquid-glass"]);
    });
  }
});

for (const [available, target] of [["x64", "arm64"], ["arm64", "x64"]]) {
  test(`a ${available} prebuild cannot satisfy a ${target} package`, (t) => {
    const root = fixture(t, { [`win32-${available}`]: WINDOWS_RUNTIME_FILES });
    assert.deepEqual(ignored(root, { arch: target }), ["electron-liquid-glass"]);
  });
}

test("Windows without bundled binaries falls back to rebuilding", (t) => {
  const root = fixture(t, {});
  assert.deepEqual(ignored(root), ["electron-liquid-glass"]);
});

test("Windows prebuilds do not suppress another platform's rebuild", (t) => {
  const root = fixture(t, {
    "win32-x64": WINDOWS_RUNTIME_FILES,
    "darwin-x64": ["pty.node", "spawn-helper"],
    "linux-x64": ["pty.node"],
  });
  assert.deepEqual(ignored(root, { platform: "darwin" }), []);
  assert.deepEqual(ignored(root, { platform: "linux" }), ["electron-liquid-glass"]);
});

test("packaging rebuilds the target architecture and propagates native failures", async () => {
  const configPath = path.resolve(__dirname, "../electron-builder.config.js");
  const localRequire = createRequire(configPath);
  const { Arch } = localRequire("electron-builder");
  const calls = [];
  let rebuildError;
  const configModule = { exports: {} };
  vm.runInNewContext(fs.readFileSync(configPath, "utf8"), {
    module: configModule,
    require: (id) => id === "./scripts/rebuild-native.cjs"
      ? { rebuildNativeModules: async (options) => {
        calls.push(options);
        if (rebuildError) throw rebuildError;
      } }
      : id === "./scripts/check-native-dependencies.cjs"
        ? { checkNativeDependencies: () => {} }
        : localRequire(id),
  }, { filename: configPath });

  const config = configModule.exports;
  assert.equal(config.npmRebuild, false);
  assert.equal(config.beforeBuild, undefined);
  const appDir = path.resolve("fixture-app");
  const context = {
    arch: Arch.x64,
    packager: {
      info: { appDir, framework: { version: "40.4.0" } },
      platform: { nodeName: "win32" },
      config: { buildDependenciesFromSource: false },
    },
  };
  for (const arch of ["x64", "arm64"]) {
    context.arch = Arch[arch];
    const result = await config.beforePack(context);
    assert.equal(result, undefined);
    assert.deepEqual({ ...calls.at(-1) }, {
      buildPath: appDir,
      electronVersion: "40.4.0",
      platform: "win32",
      arch,
      buildFromSource: false,
    });
  }

  context.packager.config.buildDependenciesFromSource = true;
  rebuildError = new Error("native compiler unavailable");
  await assert.rejects(config.beforePack(context), { message: rebuildError.message });
  assert.equal(calls.at(-1).buildFromSource, true);
});
