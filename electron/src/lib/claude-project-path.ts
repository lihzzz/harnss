import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Matches the project directory encoder in Claude Agent SDK's bundled CLI. */
export function encodeClaudeProjectPath(projectPath: string): string {
  const encoded = projectPath.replace(/[^a-zA-Z0-9]/g, "-");
  if (encoded.length <= 200) return encoded;
  let hash = 0;
  for (let index = 0; index < projectPath.length; index++) {
    hash = ((hash << 5) - hash + projectPath.charCodeAt(index)) | 0;
  }
  return `${encoded.slice(0, 200)}-${Math.abs(hash).toString(36)}`;
}

/** The CLI canonicalizes cwd before deriving its history directory. */
export function getClaudeProjectDirectory(
  projectPath: string,
  configDirectory = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude"),
): string {
  let canonicalPath = path.resolve(projectPath);
  try {
    canonicalPath = fs.realpathSync(canonicalPath);
  } catch { /* The project may have been moved or deleted since its last session. */ }
  const projectKey = encodeClaudeProjectPath(canonicalPath.normalize("NFC"));
  return path.join(configDirectory.normalize("NFC"), "projects", projectKey);
}
