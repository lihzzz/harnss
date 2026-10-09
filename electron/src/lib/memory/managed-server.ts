import { execFile } from "node:child_process";
import type { HindsightServer, HindsightServerOptions } from "@vectorize-io/hindsight-all";

export type MemoryServer = Pick<HindsightServer, "start" | "stop" | "checkHealth">;
type HindsightModule = Pick<typeof import("@vectorize-io/hindsight-all"), "HindsightServer" | "getEmbedCommand">;

/** hindsight-all 0.10's stop omits the startup environment and swallows failures. */
export function createManagedMemoryServer(hindsight: HindsightModule, options: HindsightServerOptions): MemoryServer {
  const native = new hindsight.HindsightServer(options);
  const [command, ...baseArgs] = hindsight.getEmbedCommand(options);
  if (!command) throw new Error("The Hindsight CLI command is unavailable");
  const env = { ...process.env };
  if (process.platform === "darwin" && options.platformCpuWorkaround !== false) {
    env.HINDSIGHT_API_EMBEDDINGS_LOCAL_FORCE_CPU = "1";
    env.HINDSIGHT_API_RERANKER_LOCAL_FORCE_CPU = "1";
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined) env[key] = value;
  }

  return {
    start: () => native.start(),
    checkHealth: () => native.checkHealth(),
    stop: () => new Promise<void>((resolve, reject) => {
      execFile(command, [...baseArgs, "daemon", "--profile", options.profile ?? "default", "stop"], {
        env, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024,
      }, (error) => { if (error) reject(error); else resolve(); });
    }),
  };
}
