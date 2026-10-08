import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { SkillInfo, SkillSource, SkillSourceStatus, SkillsListResult } from "@shared/types/skills";

/** Well-known per-agent skills directories scanned by default. */
const SKILL_SOURCES: Array<{ source: SkillSource; dir: string }> = [
  { source: "claude", dir: path.join(os.homedir(), ".claude", "skills") },
  { source: "codex", dir: path.join(os.homedir(), ".codex", "skills") },
  { source: "agents", dir: path.join(os.homedir(), ".agents", "skills") },
];

/**
 * Extracts `name` / `description` from SKILL.md YAML frontmatter.
 * Intentionally minimal: only flat `key: value` pairs between the leading
 * `---` fences are considered, which covers the agent-skills convention.
 */
export function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(name|description):\s*(.+?)\s*$/);
    if (!kv) continue;
    const value = kv[2].replace(/^["']|["']$/g, "");
    if (kv[1] === "name" && !result.name) result.name = value;
    if (kv[1] === "description" && !result.description) result.description = value;
  }
  return result;
}

async function scanSourceDir(source: SkillSource, dir: string): Promise<SkillInfo[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillDir = path.join(dir, entry.name);
    let name = entry.name;
    let description = "";
    try {
      const raw = await fs.readFile(path.join(skillDir, "SKILL.md"), "utf8");
      const meta = parseSkillFrontmatter(raw);
      if (meta.name) name = meta.name;
      if (meta.description) description = meta.description;
    } catch {
      // No readable SKILL.md — keep the directory name as a fallback.
    }
    skills.push({ name, description, path: skillDir, source });
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/** Scans all known agent skills directories and returns discovered skills. */
export async function listInstalledSkills(): Promise<SkillsListResult> {
  const skills: SkillInfo[] = [];
  const sources: SkillSourceStatus[] = [];
  for (const { source, dir } of SKILL_SOURCES) {
    try {
      const found = await scanSourceDir(source, dir);
      skills.push(...found);
      sources.push({ source, path: dir, exists: true });
    } catch {
      sources.push({ source, path: dir, exists: false });
    }
  }
  return { skills, sources };
}
