import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface Project {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  spaceId?: string;
  icon?: string;
  iconType?: "emoji" | "lucide";
}

const listeners = new Set<() => void>();
export function onProjectsChanged(listener: () => void): () => void {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function notifyProjectsChanged(report: (label: string, error: unknown) => void = console.error): void {
  for (const listener of listeners) {
    try { listener(); } catch (error) { report("PROJECTS:CHANGE_LISTENER", error); }
  }
}

export function readProjectCatalog(root: string, strict = false): Project[] {
  const file = path.join(root, "projects.json");
  if (!fs.existsSync(file)) return [];
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(value)) throw new Error("Invalid project catalog");
    return value as Project[];
  } catch (error) { if (strict) throw error; return []; }
}

// Catalog mutations are small and synchronous, so a deletion's read/filter/write
// cannot overwrite another project's rename or creation across an await.
export function writeProjectCatalog(root: string, projects: Project[], report?: (label: string, error: unknown) => void): void {
  const file = path.join(root, "projects.json");
  const temporary = `${file}.tmp-${randomUUID()}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(projects, null, 2), "utf8");
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, { force: true }); }
  notifyProjectsChanged(report);
}
