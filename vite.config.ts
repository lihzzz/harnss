import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
      "@speech-runtime": path.resolve(__dirname, "node_modules/@huggingface/transformers/dist"),
    },
  },
  build: {
    outDir: "dist",
    // No manualChunks: object-form manualChunks hoisted shared deps (e.g. `scheduler`)
    // into vendor chunks, forcing lazily-imported vendors (konva, syntax highlighter)
    // into the eager entry graph. Rollup's automatic chunking respects dynamic import
    // boundaries and keeps them lazy.
  },
  worker: { format: "es" },
  server: {
    port: 5173,
    strictPort: true,
  },
});
