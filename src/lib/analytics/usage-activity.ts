import { USAGE_IDLE_MS, USAGE_MAX_GAP_MS } from "@shared/lib/usage";
import type { UsageInterval } from "@shared/types/usage";

/** Tracks recent interaction without treating a suspended renderer as active. */
export class UsageActivity {
  private since: number | null = null;
  private activeUntil = 0;

  interact(now: number): UsageInterval | null {
    // Flush an expired window before extending it; do not fill the idle gap.
    const previous = now >= this.activeUntil ? this.sample(now) : null;
    if (this.since === null || now - this.since > USAGE_MAX_GAP_MS) this.since = now;
    this.activeUntil = now + USAGE_IDLE_MS;
    return previous;
  }

  sample(now: number): UsageInterval | null {
    const start = this.since;
    const end = Math.min(now, this.activeUntil);
    this.since = start !== null && now < this.activeUntil ? now : null;
    if (start === null || now - start > USAGE_MAX_GAP_MS || end <= start) return null;
    return [start, end];
  }

  pause(now: number): UsageInterval | null {
    const interval = this.sample(now);
    this.since = null;
    this.activeUntil = 0;
    return interval;
  }
}
