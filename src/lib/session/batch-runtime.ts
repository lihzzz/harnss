import type { BatchJob, BatchStartRequest } from "@shared/types/productivity";
import type { PersistedSession } from "@/types";

interface LiveSnapshot { data: PersistedSession; inProgress: boolean }
const snapshots = new Map<string, () => LiveSnapshot>();
const frozen = new Map<string, Set<string>>();
const deleted = new Set<string>();
const pendingDeletions = new Set<string>();
const runtimeAliases = new Map<string, Set<string>>();
const retiredRuntimes = new Set<string>();
const recoveries = new Set<string>();
const recoveryListeners = new Set<() => void>();
let recoveryVersion = 0;
export function subscribeSessionRecoveries(listener: () => void): () => void { recoveryListeners.add(listener); return () => { recoveryListeners.delete(listener); }; }
export function getSessionRecoveryVersion(): number { return recoveryVersion; }
function recoveryChanged(): void { recoveryVersion++; for (const listener of recoveryListeners) listener(); }
const listeners = new Set<() => void>();
const jobs = new Map<string, BatchJob>();
let jobSnapshot: BatchJob[] = [];

export function subscribeBatchJobs(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getBatchJobs(): BatchJob[] { return jobSnapshot; }
export function rememberBatchJob(job: BatchJob): void {
  const previous = jobs.get(job.jobId);
  if (previous && previous.seq >= job.seq) return;
  jobs.set(job.jobId, job);
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, value] of jobs) if (value.completedAt !== null && value.completedAt < cutoff) jobs.delete(id);
  jobSnapshot = [...jobs.values()];
  for (const listener of listeners) listener();
}

export async function startBatchJob(request: BatchStartRequest): Promise<BatchJob> {
  const result = await window.claude.sessions.batch.start(request);
  if (!result.ok) throw new Error(result.error.message);
  rememberBatchJob(result.value);
  const current = await window.claude.sessions.batch.status(result.value.jobId);
  if (current.ok) rememberBatchJob(current.value);
  return jobs.get(result.value.jobId) ?? result.value;
}

export function waitForBatchJob(jobId: string): Promise<BatchJob> {
  return new Promise((resolve) => {
    const check = () => {
      const job = jobs.get(jobId);
      if (job && job.completedAt !== null) { unsubscribe(); resolve(job); }
    };
    const unsubscribe = subscribeBatchJobs(check);
    check();
  });
}

export function registerLiveSnapshot(id: string, getSnapshot: () => LiveSnapshot): () => void {
  snapshots.set(id, getSnapshot);
  return () => { if (snapshots.get(id) === getSnapshot) snapshots.delete(id); };
}
export function getLiveSnapshot(id: string): LiveSnapshot | null { return snapshots.get(id)?.() ?? null; }
export function isSessionFrozen(id: string | null): boolean { return !!id && (frozen.has(id) || deleted.has(id) || pendingDeletions.has(id)); }
export function isSessionRetired(id: string): boolean { return retiredRuntimes.has(id); }
export function isSessionRecovering(id: string): boolean { return [...(runtimeAliases.get(id) ?? [id])].some((alias) => recoveries.has(alias)); }
export function beginSessionRecovery(id: string): (() => void) | null {
  if (isSessionFrozen(id) || isSessionRetired(id) || isSessionRecovering(id)) return null;
  recoveries.add(id);
  recoveryChanged();
  return () => { if (recoveries.delete(id)) recoveryChanged(); };
}

/** Keep deletion ownership across a successfully saved runtime replacement. */
export function replaceSessionRuntime(previousId: string, nextId: string): void {
  if (previousId === nextId) return;
  const aliases = new Set([...(runtimeAliases.get(previousId) ?? [previousId]), ...(runtimeAliases.get(nextId) ?? [nextId])]);
  const owners = new Set([...aliases].flatMap((id) => [...(frozen.get(id) ?? [])]));
  const wasDeleted = [...aliases].some((id) => deleted.has(id));
  const pending = [...aliases].some((id) => pendingDeletions.has(id));
  for (const id of aliases) {
    runtimeAliases.set(id, aliases);
    if (owners.size) frozen.set(id, owners);
    if (wasDeleted) deleted.add(id);
    else if (pending) pendingDeletions.add(id);
  }
  retiredRuntimes.add(previousId);
}
export function freezeSession(id: string, jobId: string): void {
  const owners = frozen.get(id) ?? new Set<string>();
  owners.add(jobId);
  for (const alias of runtimeAliases.get(id) ?? [id]) frozen.set(alias, owners);
}
export function releaseSession(id: string, jobId: string, wasDeleted: boolean, deletionState?: "pending" | "available"): void {
  for (const alias of runtimeAliases.get(id) ?? [id]) {
    if (wasDeleted) { deleted.add(alias); pendingDeletions.delete(alias); }
    else if (deletionState === "pending") pendingDeletions.add(alias);
    else if (deletionState === "available") pendingDeletions.delete(alias);
    const owners = frozen.get(alias);
    owners?.delete(jobId);
    if (!owners?.size) frozen.delete(alias);
  }
}
