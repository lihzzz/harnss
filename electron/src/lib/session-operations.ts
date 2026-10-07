import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { BatchJob, BatchPreparedRequest, BatchStartRequest, ConversationRef } from "@shared/types/productivity";
import { buildSessionMarkdown, markdownMessages, sanitizeExportFileName } from "@shared/lib/session-markdown";
import { extractSessionMeta } from "@shared/lib/session-persistence";
import { SessionRepository } from "./session-repository";
import { operationError, ProductivityError } from "./productivity-errors";

interface BatchDependencies {
  repository: SessionRepository;
  remove: (projectId: string, runtimeId: string) => Promise<void | "deleted" | "already_deleted">;
  chooseDirectory: () => Promise<string | null>;
  progress: (job: BatchJob) => void;
  prepare: (job: BatchJob) => void;
}
interface JobControl {
  job: BatchJob;
  fingerprint: string;
  cancelled: boolean;
  prepared: BatchPreparedRequest | null;
  acceptPreparation: ((results: BatchPreparedRequest["results"]) => void) | null;
  publishTimer?: ReturnType<typeof setTimeout>;
  publishedAt?: number;
}
const RETENTION_MS = 30 * 60_000;
const PREPARATION_MS = 30_000;

/** Batch jobs never replay on restart; only durable deletion records recover. */
export class SessionOperations {
  private readonly jobs = new Map<string, JobControl>();
  private readonly requests = new Map<string, string>();
  private readonly owners = new Map<string, string>();
  constructor(private readonly dependencies: BatchDependencies) {}

  private publish(control: JobControl, immediate = false): void {
    control.job.seq++;
    const send = () => {
      if (control.publishTimer) clearTimeout(control.publishTimer);
      control.publishTimer = undefined;
      control.publishedAt = Date.now();
      this.dependencies.progress(structuredClone(control.job));
    };
    const remaining = 250 - (Date.now() - (control.publishedAt ?? 0));
    if (immediate || remaining <= 0) send();
    else if (!control.publishTimer) control.publishTimer = setTimeout(send, remaining);
  }
  private control(jobId: string): JobControl {
    const control = this.jobs.get(jobId);
    if (!control) throw new ProductivityError("UNKNOWN_JOB", "The job expired; verify the actual session or exported files");
    return control;
  }
  status(jobId: string): BatchJob { this.prune(); return structuredClone(this.control(jobId).job); }

  /** Expose interrupted deletions as retryable results without replaying a batch. */
  async recoveries(): Promise<BatchJob[]> {
    this.prune();
    const targets = (await this.dependencies.repository.pendingDeletions()).sort((a, b) => a.conversationKey.localeCompare(b.conversationKey));
    const recovered: BatchJob[] = [];
    for (let offset = 0; offset < targets.length; offset += 500) {
      const items = targets.slice(offset, offset + 500);
      const fingerprint = JSON.stringify(items.map((item) => item.conversationKey));
      const requestId = `recovery:${createHash("sha256").update(fingerprint).digest("hex")}`;
      const previous = this.requests.get(requestId);
      if (previous) { recovered.push(this.status(previous)); continue; }
      const now = Date.now();
      const job: BatchJob = { jobId: randomUUID(), requestId, action: "delete", state: "failed", seq: 1, preparation: null,
        createdAt: now, completedAt: now, items: items.map((item) => ({ projectId: item.projectId, conversationKey: item.conversationKey,
          runtimeSessionId: item.id, title: item.title, state: "failed", outputPath: null,
          error: { code: "DELETE_INCOMPLETE", message: "Deletion is incomplete. This conversation remains blocked; retry deletion to finish.", retryable: true } })) };
      this.jobs.set(job.jobId, { job, fingerprint, cancelled: false, prepared: null, acceptPreparation: null });
      this.requests.set(requestId, job.jobId);
      recovered.push(structuredClone(job));
    }
    return recovered;
  }
  private prune(): void {
    for (const [id, control] of this.jobs) {
      if (control.job.completedAt !== null && Date.now() - control.job.completedAt > RETENTION_MS) {
        this.jobs.delete(id);
        this.requests.delete(control.job.requestId);
      }
    }
  }

  async start(request: BatchStartRequest): Promise<BatchJob> {
    this.prune();
    if (!request.requestId || request.requestId.length > 200 || request.targets.length < 1 || request.targets.length > 500
      || !["archive", "delete", "exportMarkdown"].includes(request.action)) throw new ProductivityError("INVALID_ARGUMENT");
    const unique = new Map(request.targets.map((target) => [JSON.stringify([target.projectId, target.conversationKey]), target]));
    const targets: ConversationRef[] = [...unique.values()].map((target) => ({ ...target }));
    const fingerprint = JSON.stringify([request.action, targets]);
    const previousId = this.requests.get(request.requestId);
    if (previousId) {
      const previous = this.control(previousId);
      if (previous.fingerprint !== fingerprint) throw new ProductivityError("INVALID_ARGUMENT", "This request ID was used for another operation");
      return structuredClone(previous.job);
    }
    const job: BatchJob = { jobId: randomUUID(), requestId: request.requestId, action: request.action, state: "preparing", seq: 0,
      items: targets.map((target) => ({ ...target, runtimeSessionId: "", title: "", state: "pending", error: null, outputPath: null })),
      preparation: null, createdAt: Date.now(), completedAt: null };
    const control: JobControl = { job, fingerprint, cancelled: false, prepared: null, acceptPreparation: null };
    // Reserve the request before the first await, including double-clicked IPC invocations.
    this.jobs.set(job.jobId, control);
    this.requests.set(request.requestId, job.jobId);
    for (const item of job.items) {
      if (this.owners.has(item.conversationKey)) {
        item.state = "failed";
        item.error = { code: "BUSY", message: "Another operation is using this conversation. Retry when it finishes.", retryable: true };
      } else this.owners.set(item.conversationKey, job.jobId);
    }
    this.publish(control);
    void this.run(control).catch((error: unknown) => {
      for (const item of job.items) if (item.state === "pending" || item.state === "running") { item.state = "failed"; item.error = operationError(error); }
      this.finish(control);
    });
    return structuredClone(job);
  }

  cancel(jobId: string): BatchJob {
    const control = this.control(jobId);
    if (control.job.completedAt !== null) return structuredClone(control.job);
    control.cancelled = true;
    for (const item of control.job.items) if (item.state === "pending") item.state = "cancelled";
    control.acceptPreparation?.([]);
    this.publish(control, true);
    return structuredClone(control.job);
  }

  prepared(request: BatchPreparedRequest): BatchJob {
    const control = this.control(request.jobId);
    if (control.prepared?.prepareId === request.prepareId) return structuredClone(control.job);
    if (!control.job.preparation || control.job.preparation.prepareId !== request.prepareId || !control.acceptPreparation) throw new ProductivityError("INVALID_ARGUMENT", "The preparation request is no longer active");
    const expected = new Set(control.job.preparation.targets.map((target) => JSON.stringify([target.projectId, target.conversationKey])));
    const received = request.results.map((result) => JSON.stringify([result.projectId, result.conversationKey]));
    if (new Set(received).size !== received.length || received.some((key) => !expected.has(key))) throw new ProductivityError("INVALID_ARGUMENT");
    control.prepared = structuredClone(request);
    control.acceptPreparation(request.results);
    return structuredClone(control.job);
  }

  private async preparation(control: JobControl, purpose: "freeze" | "flush"): Promise<BatchPreparedRequest["results"]> {
    const targets = control.job.items.filter((item) => item.state === "pending").map(({ projectId, conversationKey }) => ({ projectId, conversationKey }));
    control.job.preparation = { prepareId: randomUUID(), purpose, targets, expiresAt: Date.now() + PREPARATION_MS };
    const promise = new Promise<BatchPreparedRequest["results"]>((resolve) => {
      const timer = setTimeout(() => resolve([]), PREPARATION_MS);
      control.acceptPreparation = (results) => { clearTimeout(timer); resolve(results); };
    });
    this.publish(control, true);
    this.dependencies.prepare(structuredClone(control.job));
    const results = await promise;
    control.acceptPreparation = null;
    control.job.preparation = null;
    return results;
  }

  private async run(control: JobControl): Promise<void> {
    const { job } = control;
    for (const item of job.items) {
      if (control.cancelled) break;
      if (item.state !== "pending") continue;
      try {
        const meta = job.action === "delete"
          ? await this.dependencies.repository.resolveDeletion(item.projectId, item.conversationKey)
          : await this.dependencies.repository.resolve(item.projectId, item.conversationKey);
        item.runtimeSessionId = meta.id;
        item.title = meta.title;
        if ("state" in meta && meta.state === "committed") {
          item.state = "skipped";
          item.error = { code: "ALREADY_DELETED", message: "This conversation was already deleted.", retryable: false };
        }
      } catch (error) { item.state = "failed"; item.error = operationError(error); }
    }
    let directory: string | null = null;
    if (job.action === "exportMarkdown" && job.items.some((item) => item.state === "pending")) {
      directory = await this.dependencies.chooseDirectory();
      if (!directory) this.cancel(job.jobId);
    }
    let prepared: BatchPreparedRequest["results"] = [];
    if (!control.cancelled && job.action !== "archive" && job.items.some((item) => item.state === "pending")) {
      prepared = await this.preparation(control, job.action === "delete" ? "freeze" : "flush");
      for (const item of job.items) {
        if (item.state !== "pending") continue;
        const result = prepared.find((result) => result.projectId === item.projectId && result.conversationKey === item.conversationKey);
        if (!result?.ok) {
          item.state = "failed";
          item.error = { code: job.action === "delete" ? "BUSY" : "SNAPSHOT_FAILED", message: result?.error ?? "The renderer did not prepare this conversation before the deadline", retryable: true };
        }
      }
    }
    job.state = "running";
    this.publish(control);
    let next = 0;
    const worker = async () => {
      while (next < job.items.length) {
        const item = job.items[next++];
        if (item.state !== "pending") continue;
        if (control.cancelled) { item.state = "cancelled"; continue; }
        item.state = "running";
        this.publish(control);
        try {
          const meta = job.action === "delete"
            ? await this.dependencies.repository.resolveDeletion(item.projectId, item.conversationKey)
            : await this.dependencies.repository.resolve(item.projectId, item.conversationKey);
          if (job.action === "archive") await this.dependencies.repository.updateMeta(item.projectId, meta.id, { archived: true });
          else if (job.action === "delete") {
            if (await this.dependencies.remove(item.projectId, meta.id) === "already_deleted") {
              item.state = "skipped";
              item.error = { code: "ALREADY_DELETED", message: "This conversation was already deleted.", retryable: false };
            }
          }
          else {
            if (!directory) throw new ProductivityError("CANCELLED");
            const data = await this.dependencies.repository.snapshot(item.projectId, item.conversationKey);
            const snapshotTime = new Date().toISOString();
            const inProgress = prepared.find((result) => result.projectId === item.projectId && result.conversationKey === item.conversationKey)?.inProgress === true;
            const markdown = buildSessionMarkdown(extractSessionMeta(data, Number(data.lastMessageAt) || 0), markdownMessages(data.messages));
            const contents = `<!-- Snapshot: ${snapshotTime}; in progress: ${inProgress} -->\n\n${markdown}`;
            const hash = createHash("sha256").update(item.conversationKey).digest("hex").slice(0, 10);
            const fileName = `${sanitizeExportFileName(meta.title)}-${hash}-${snapshotTime.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.md`;
            const output = path.join(directory, fileName);
            const temporary = path.join(directory, `.harnss-${job.jobId}-${randomUUID()}.tmp`);
            try {
              await fs.writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
              // link() publishes the complete file atomically and refuses to overwrite an existing path.
              await fs.link(temporary, output);
              item.outputPath = output;
            } finally { await fs.rm(temporary, { force: true }); }
          }
          if (item.state !== "skipped") item.state = "succeeded";
        } catch (error) { item.state = "failed"; item.error = operationError(error); }
        this.publish(control);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    this.finish(control);
  }

  private finish(control: JobControl): void {
    const { job } = control;
    const succeeded = job.items.some((item) => item.state === "succeeded");
    const failed = job.items.some((item) => item.state === "failed");
    job.state = control.cancelled ? "cancelled" : failed ? (succeeded ? "partially_failed" : "failed") : "completed";
    job.completedAt = Date.now();
    job.preparation = null;
    for (const item of job.items) if (this.owners.get(item.conversationKey) === job.jobId) this.owners.delete(item.conversationKey);
    this.publish(control, true);
  }
}
