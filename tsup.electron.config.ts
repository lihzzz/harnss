import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "electron/src/main.ts",
    preload: "electron/src/preload.ts",
    "computer-use-mcp": "electron/src/computer-use-mcp.ts",
  },
  outDir: "electron/dist",
  format: ["cjs"],
  target: "es2020",
  platform: "node",
  splitting: false,
  clean: true,
  external: [
    "electron",
    "node-pty",
    "electron-liquid-glass",
    "@anthropic-ai/claude-agent-sdk",
    "posthog-node",
    "@trycua/cua-driver",
    "@trycua/cua-driver/electron",
  ],
  noExternal: ["@modelcontextprotocol/sdk"],
  treeshake: true,
});
