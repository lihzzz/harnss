import fs from "node:fs/promises";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { AppLogEntry, AppLogPage } from "@shared/types/project-apps";
import { writeTextAtomically } from "../atomic-file";
import { isMissingFile } from "../productivity-errors";

export const APP_LOG_MEMORY_LIMIT = 1024 * 1024;
export class AppLogBuffer {
  private entries: AppLogEntry[] = [];
  private bytes = 0;
  private next = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: AppLogEntry[] = [];
  private diskTail: Promise<void> = Promise.resolve();
  private diskContent: string | null = null;
  private diskWriting = false;
  private lastEmitted = 0;
  private readonly decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8"), system: new StringDecoder("utf8") };
  private readonly redactionPending = { stdout: "", stderr: "", system: "" };
  constructor(readonly runId: string, private readonly directory: string, private readonly emit: (page: AppLogPage) => void,
    private readonly report: (error: unknown) => void, private readonly secrets: string[]) {}
  append(stream: AppLogEntry["stream"], chunk: string | Buffer): void {
    let text = typeof chunk === "string" ? chunk : this.decoders[stream].write(chunk);
    text = this.redactionPending[stream] + text;
    this.redactionPending[stream] = "";
    // Avoid terminal-control side effects and redact known credential values.
    text = text.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
    for (const secret of this.secrets) if (secret.length >= 4) text = text.replaceAll(secret, "[redacted]");
    let retained = 0;
    for (const secret of this.secrets) {
      if (secret.length < 4) continue;
      for (let length = Math.min(secret.length - 1, text.length); length > retained; length--) {
        if (secret.startsWith(text.slice(-length))) { retained = length; break; }
      }
    }
    if (retained) { this.redactionPending[stream] = text.slice(-retained); text = text.slice(0, -retained); }
    if (!text) return;
    // A single giant write must not bypass capacity limits.
    const encoded = Buffer.from(text, "utf8");
    if (encoded.length > 64 * 1024) text = `[truncated write]\n${encoded.subarray(encoded.length - 64 * 1024).toString("utf8")}`;
    const entry = { seq: ++this.next, timestamp: Date.now(), stream, text };
    this.entries.push(entry); this.pending.push(entry); this.bytes += Buffer.byteLength(text) + 100;
    while (this.entries.length && this.bytes > APP_LOG_MEMORY_LIMIT) {
      const removed = this.entries.shift(); if (removed) this.bytes -= Buffer.byteLength(removed.text) + 100;
    }
    const retainedFrom = this.entries[0]?.seq ?? this.next;
    this.pending = this.pending.filter((item) => item.seq >= retainedFrom);
    // Pending events are bounded independently when the event loop is busy.
    if (this.pending.length > 1024) this.pending = this.pending.slice(-1024);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 75);
  }
  page(afterSeq: number, limit: number): AppLogPage {
    const first = this.entries[0]?.seq ?? this.next + 1;
    const entries = this.entries.filter((entry) => entry.seq > afterSeq).slice(0, limit);
    return { runId: this.runId, entries, nextSeq: entries.at(-1)?.seq ?? this.next, truncated: afterSeq < first - 1 };
  }
  private flush(): void {
    if (this.pending.length) {
      const entries = this.pending; this.pending = [];
      this.emit({ runId: this.runId, entries, nextSeq: entries.at(-1)?.seq ?? this.next, truncated: (entries[0]?.seq ?? 0) > this.lastEmitted + 1 });
      this.lastEmitted = entries.at(-1)?.seq ?? this.lastEmitted;
    }
    // Coalesce snapshots while disk writes are slow; never queue unbounded copies
    // of the full ring buffer behind a slow filesystem.
    let retained = this.entries;
    let content = JSON.stringify(retained);
    while (retained.length > 1 && Buffer.byteLength(content) > APP_LOG_MEMORY_LIMIT * 2) { retained = retained.slice(Math.max(1, Math.floor(retained.length / 4))); content = JSON.stringify(retained); }
    this.diskContent = content;
    if (this.diskWriting) return;
    this.diskWriting = true;
    this.diskTail = (async () => {
      await fs.mkdir(this.directory, { recursive: true });
      while (this.diskContent !== null) {
        const content = this.diskContent; this.diskContent = null;
        await writeTextAtomically(path.join(this.directory, "output.json"), content);
      }
    })().catch((error: unknown) => { this.diskContent = null; this.report(error); }).finally(() => { this.diskWriting = false; });
  }
  async close(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    do { this.flush(); await this.diskTail; } while (this.diskContent !== null);
  }
  async restore(): Promise<void> {
    try {
      const file = path.join(this.directory, "output.json");
      if ((await fs.stat(file)).size > APP_LOG_MEMORY_LIMIT * 3) return;
      const value: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!Array.isArray(value)) return;
      for (const entry of value) {
        if (entry && typeof entry === "object" && "seq" in entry && typeof entry.seq === "number" && "text" in entry && typeof entry.text === "string"
          && "timestamp" in entry && typeof entry.timestamp === "number" && "stream" in entry && (entry.stream === "stdout" || entry.stream === "stderr" || entry.stream === "system")) {
          this.entries.push({ seq: entry.seq, text: entry.text, timestamp: entry.timestamp, stream: entry.stream });
          this.next = Math.max(this.next, entry.seq); this.bytes += Buffer.byteLength(entry.text) + 100;
        }
      }
      while (this.entries.length && this.bytes > APP_LOG_MEMORY_LIMIT) { const entry = this.entries.shift(); if (entry) this.bytes -= Buffer.byteLength(entry.text) + 100; }
    } catch (error) { if (!isMissingFile(error)) this.report(error); }
  }
}
