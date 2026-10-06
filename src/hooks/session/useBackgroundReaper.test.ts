import { describe, expect, it } from "vitest";
import { selectReapCandidates, type ReapCandidateInfo } from "./useBackgroundReaper";

function info(overrides: Partial<ReapCandidateInfo> = {}): ReapCandidateInfo {
  return { sid: "x", isProcessing: false, hasPendingPermission: false, lastActivityAt: 0, ...overrides };
}

describe("selectReapCandidates", () => {
  it("returns nothing when under the limit or the limit is disabled", () => {
    expect(selectReapCandidates(["a", "b"], 4, () => info())).toEqual([]);
    expect(selectReapCandidates(["a", "b"], 0, () => info())).toEqual([]);
  });

  it("reaps the least recently active idle sessions beyond the limit", () => {
    const infos: Record<string, ReapCandidateInfo> = {
      a: info({ sid: "a", lastActivityAt: 1 }),
      b: info({ sid: "b", lastActivityAt: 2 }),
      c: info({ sid: "c", lastActivityAt: 3 }),
    };
    expect(selectReapCandidates(["a", "b", "c"], 2, (sid) => infos[sid])).toEqual(["a"]);
    expect(selectReapCandidates(["a", "b", "c"], 1, (sid) => infos[sid])).toEqual(["a", "b"]);
  });

  it("never reaps sessions that are processing or awaiting permission", () => {
    const infos: Record<string, ReapCandidateInfo> = {
      busy: info({ sid: "busy", isProcessing: true, lastActivityAt: 1 }),
      perm: info({ sid: "perm", hasPendingPermission: true, lastActivityAt: 2 }),
      idle: info({ sid: "idle", lastActivityAt: 3 }),
    };
    // 3 live, limit 1 → 2 excess, but only "idle" is reapable
    expect(selectReapCandidates(["busy", "perm", "idle"], 1, (sid) => infos[sid])).toEqual(["idle"]);
  });

  it("skips sessions with no state (already gone)", () => {
    expect(selectReapCandidates(["a", "b"], 1, () => undefined)).toEqual([]);
  });
});
