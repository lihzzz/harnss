import { mergeUsageIntervals, USAGE_MAX_GAP_MS } from "@shared/lib/usage";
import type { UsageInterval, UsageTimings } from "@shared/types/usage";

/** Wall-clock union across all running turns; runtime state is never restored. */
export class UsageTracker {
  readonly data: UsageTimings;
  private running = new Map<string, Set<string>>();
  private since: number | null = null;
  private resumedAt: number;

  constructor(now: number, saved?: UsageTimings) {
    this.data = saved ?? { version: 1, trackingStartedAt: now, active: [], agent: [] };
    this.resumedAt = now;
  }

  begin(sessionId: string, turnId: string, now = Date.now()): void {
    if (!this.running.size) this.since = now;
    const turns = this.running.get(sessionId) ?? new Set<string>();
    turns.add(turnId);
    this.running.set(sessionId, turns);
  }

  end(sessionId: string, turnId: string, now = Date.now()): void {
    const turns = this.running.get(sessionId);
    if (!turns?.has(turnId)) return;
    this.checkpoint(now);
    turns.delete(turnId);
    if (!turns.size) this.running.delete(sessionId);
    if (!this.running.size) this.since = null;
  }

  stopSession(sessionId: string, now = Date.now()): void {
    this.checkpoint(now);
    this.running.delete(sessionId);
    if (!this.running.size) this.since = null;
  }

  checkpoint(now = Date.now()): void {
    if (this.since === null) return;
    if (now - this.since <= USAGE_MAX_GAP_MS) this.append("agent", [this.since, now]);
    this.since = now;
  }

  /** A resume checkpoint prevents the sleep interval from becoming processing time. */
  resume(now = Date.now()): void {
    this.resumedAt = now;
    if (this.since !== null) this.since = now;
  }

  activity(start: number, end: number): void {
    this.append("active", [Math.max(start, this.data.trackingStartedAt, this.resumedAt), end]);
  }

  private append(kind: "active" | "agent", interval: UsageInterval): void {
    if (interval[1] <= interval[0]) return;
    const intervals = this.data[kind];
    const last = intervals.at(-1);
    if (!last || interval[0] > last[1]) intervals.push(interval);
    else if (interval[0] >= last[0]) last[1] = Math.max(last[1], interval[1]);
    else this.data[kind] = mergeUsageIntervals([...intervals, interval]);
  }
}
