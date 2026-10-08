import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { assertStorageId, isMissingFile, isRecord, ProductivityError } from "./productivity-errors";

export const SESSION_SOURCE_FORMATS = ["json", "jsonl", "meta.json"] as const;
export type SessionSourceFormat = typeof SESSION_SOURCE_FORMATS[number];
export interface SessionReplacement {
  version: 1;
  projectId: string;
  previousId: string;
  runtimeId: string;
  previousKey: string;
  conversationKey: string;
  retiredIds: string[];
  backupFormats: SessionSourceFormat[];
  state: "prepared" | "committed";
}

export const runtimeAlias = (projectId: string, id: string): string => JSON.stringify([projectId, id]);
export function replacementPath(root: string, record: Pick<SessionReplacement, "projectId" | "runtimeId" | "previousId" | "previousKey" | "conversationKey">): string {
  assertStorageId(record.projectId); assertStorageId(record.runtimeId);
  // Preserve the original v1 runtime-handoff path. One runtime can undergo
  // several identity promotions, each of which must retain its own redirect.
  const identity = record.previousId === record.runtimeId
    ? JSON.stringify([record.projectId, record.runtimeId, record.previousKey, record.conversationKey])
    : runtimeAlias(record.projectId, record.runtimeId);
  return path.join(root, "sessions", ".replacements", `${createHash("sha256").update(identity).digest("hex")}.json`);
}

export function replacementBackupDirectory(root: string, record: SessionReplacement): string {
  return replacementPath(root, record) + ".backup";
}

export function replacementBackupFile(root: string, record: SessionReplacement, format: SessionSourceFormat): string {
  return path.join(replacementBackupDirectory(root, record), `${record.runtimeId}.${format}`);
}

export function assertReplacementKeys(record: Pick<SessionReplacement, "projectId" | "previousKey" | "conversationKey">): void {
  function engine(key: string): string | null {
    let tuple: unknown;
    try { tuple = JSON.parse(key); } catch { return null; }
    return Array.isArray(tuple) && tuple.length === 3 && tuple[0] === record.projectId && typeof tuple[1] === "string"
      && ["claude", "acp", "codex"].includes(tuple[1]) && typeof tuple[2] === "string" && !!tuple[2] ? tuple[1] : null;
  }
  const previous = engine(record.previousKey);
  if (!previous || previous !== engine(record.conversationKey)) throw new ProductivityError("INVALID_ARGUMENT", "Invalid replacement identity");
}

/** These records belong to source correctness, never the disposable history cache. */
export async function readSessionReplacements(root: string): Promise<SessionReplacement[]> {
  const folder = path.join(root, "sessions", ".replacements");
  const files = await fs.readdir(folder).catch((error: unknown) => { if (isMissingFile(error)) return []; throw error; });
  const records: SessionReplacement[] = [];
  for (const name of files.filter((file) => file.endsWith(".json"))) {
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(path.join(folder, name), "utf8")); }
    catch (error) { if (isMissingFile(error)) continue; if (error instanceof SyntaxError) throw new ProductivityError("REPLACEMENT_STATE_INVALID"); throw error; }
    if (!isRecord(raw) || raw.version !== 1 || typeof raw.projectId !== "string" || typeof raw.previousId !== "string"
      || typeof raw.runtimeId !== "string" || typeof raw.previousKey !== "string"
      || typeof raw.conversationKey !== "string" || (raw.state !== "prepared" && raw.state !== "committed")) throw new ProductivityError("REPLACEMENT_STATE_INVALID");
    try { assertStorageId(raw.projectId); assertStorageId(raw.previousId); assertStorageId(raw.runtimeId); }
    catch { throw new ProductivityError("REPLACEMENT_STATE_INVALID"); }
    try { assertReplacementKeys({ projectId: raw.projectId, previousKey: raw.previousKey, conversationKey: raw.conversationKey }); }
    catch { throw new ProductivityError("REPLACEMENT_STATE_INVALID"); }
    // Early v1 runtime records only retired their named source; retain that
    // interpretation when loading them instead of guessing additional aliases.
    const aliases: unknown = raw.retiredIds ?? [raw.previousId];
    const formats: unknown = raw.backupFormats ?? [];
    if (!Array.isArray(aliases) || !aliases.every((id: unknown) => typeof id === "string" && id !== raw.runtimeId)
      || !Array.isArray(formats) || !formats.every((format: unknown) => typeof format === "string" && SESSION_SOURCE_FORMATS.some((value) => value === format))) throw new ProductivityError("REPLACEMENT_STATE_INVALID");
    const retiredIds = aliases.filter((id: unknown): id is string => typeof id === "string");
    const backupFormats = formats.filter((format: unknown): format is SessionSourceFormat => SESSION_SOURCE_FORMATS.some((value) => value === format));
    try { retiredIds.forEach(assertStorageId); }
    catch { throw new ProductivityError("REPLACEMENT_STATE_INVALID"); }
    const inPlace = raw.previousId === raw.runtimeId;
    if (new Set(retiredIds).size !== retiredIds.length || new Set(backupFormats).size !== backupFormats.length
      || (inPlace ? raw.previousKey === raw.conversationKey || !backupFormats.some((format) => format !== "meta.json") : backupFormats.length > 0 || !retiredIds.includes(raw.previousId))) throw new ProductivityError("REPLACEMENT_STATE_INVALID");
    const record: SessionReplacement = { version: 1, projectId: raw.projectId, previousId: raw.previousId, runtimeId: raw.runtimeId,
      previousKey: raw.previousKey, conversationKey: raw.conversationKey, retiredIds, backupFormats, state: raw.state };
    if (name !== path.basename(replacementPath(root, record))) throw new ProductivityError("REPLACEMENT_STATE_INVALID");
    records.push(record);
  }
  return records;
}

export function replacementVisibility(records: SessionReplacement[]): { runtimeAliases: Set<string>; logicalKeys: Set<string>; preparedSources: Map<string, SessionReplacement> } {
  const runtimeAliases = new Set<string>(); const logicalKeys = new Set<string>();
  const preparedSources = new Map<string, SessionReplacement>();
  for (const record of records) {
    if (record.state === "committed") for (const id of record.retiredIds) runtimeAliases.add(runtimeAlias(record.projectId, id));
    else if (record.previousId !== record.runtimeId) runtimeAliases.add(runtimeAlias(record.projectId, record.runtimeId));
    else preparedSources.set(runtimeAlias(record.projectId, record.runtimeId), record);
    if (record.state === "committed" && record.previousKey !== record.conversationKey) logicalKeys.add(record.previousKey);
  }
  return { runtimeAliases, logicalKeys, preparedSources };
}
