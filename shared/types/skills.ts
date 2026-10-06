/** Agent skill discovery types shared between main and renderer. */

/** Which agent ecosystem a skill directory belongs to. */
export type SkillSource = "claude" | "codex" | "agents";

export interface SkillInfo {
  /** Skill name from SKILL.md frontmatter (falls back to directory name). */
  name: string;
  /** Skill description from SKILL.md frontmatter. */
  description: string;
  /** Absolute path to the skill directory. */
  path: string;
  source: SkillSource;
}

export interface SkillSourceStatus {
  source: SkillSource;
  /** Absolute path of the scanned skills directory. */
  path: string;
  /** Whether the directory exists on this machine. */
  exists: boolean;
}

export interface SkillsListResult {
  skills: SkillInfo[];
  sources: SkillSourceStatus[];
}
