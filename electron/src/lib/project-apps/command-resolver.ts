import type { AppLaunchProfile } from "@shared/types/project-apps";
import { appRecord } from "@shared/lib/project-apps";
import { resolveExecutableCommand } from "../command-launch";
import { ProductivityError } from "../productivity-errors";
import { readPackage } from "./discovery";

export function cleanAppEnvironment(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const result = { ...process.env, ...overrides };
  for (const key of Object.keys(result)) if (/^(?:ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|NODE_OPTIONS|VSCODE_INSPECTOR_OPTIONS|NODE_INSPECT_RESUME_ON_START)$/i.test(key)) delete result[key];
  return result;
}
export async function prepareAppCommand(launch: AppLaunchProfile, cwd: string, port: number | null, env: NodeJS.ProcessEnv) {
  const command = launch.command;
  let executable: string;
  let args: string[];
  if (command.kind === "package-script") {
    const pkg = await readPackage(cwd);
    const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? appRecord(pkg.scripts) : {};
    if (typeof scripts[command.script] !== "string") throw new ProductivityError("COMMAND_NOT_FOUND", `Package script '${command.script}' does not exist`);
    executable = command.manager;
    args = ["run", command.script, ...(command.manager === "npm" ? ["--"] : []), ...command.args];
  } else { executable = command.executable; args = [...command.args]; }
  if (port !== null && launch.adapter === "vite") args.push("--host", "127.0.0.1", "--port", String(port), "--strictPort");
  if (port !== null && launch.adapter === "next") args.push("--hostname", "127.0.0.1", "--port", String(port));
  try { resolveExecutableCommand(executable, args, { cwd, env }); }
  catch (error) { throw new ProductivityError("COMMAND_NOT_FOUND", error instanceof Error ? error.message : "Executable not found"); }
  return { executable, args };
}
