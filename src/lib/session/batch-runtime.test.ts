import { describe, expect, it } from "vitest";
import { beginSessionRecovery, freezeSession, getSessionRecoveryVersion, isSessionFrozen, isSessionRecovering, isSessionRetired, releaseSession, replaceSessionRuntime, subscribeSessionRecoveries } from "./batch-runtime";

describe("batch deletion guards", () => {
  it("keeps an incomplete deletion blocked, but releases it if a later stop failure rolls back the intent", () => {
    freezeSession("incomplete", "first");
    releaseSession("incomplete", "first", false, "pending");
    expect(isSessionFrozen("incomplete")).toBe(true);
    freezeSession("incomplete", "retry");
    releaseSession("incomplete", "retry", false, "available");
    expect(isSessionFrozen("incomplete")).toBe(false);
  });

  it("never clears a committed deletion guard when another operation releases its lease", () => {
    freezeSession("committed", "delete");
    releaseSession("committed", "delete", true);
    releaseSession("committed", "late", false, "available");
    expect(isSessionFrozen("committed")).toBe(true);
  });

  it("retains other freeze owners and a pending deletion when a retry is cancelled", () => {
    freezeSession("owners", "first");
    freezeSession("owners", "second");
    releaseSession("owners", "first", false);
    expect(isSessionFrozen("owners")).toBe(true);
    releaseSession("owners", "second", false, "pending");
    freezeSession("owners", "cancelled-retry");
    releaseSession("owners", "cancelled-retry", false);
    expect(isSessionFrozen("owners")).toBe(true);
  });

  it("carries all deletion owners across repeated runtime replacements", () => {
    const first = crypto.randomUUID(), second = crypto.randomUUID(), third = crypto.randomUUID();
    freezeSession(first, "delete-first"); freezeSession(second, "delete-second");
    replaceSessionRuntime(first, second); replaceSessionRuntime(second, third);
    releaseSession(third, "delete-first", false);
    for (const id of [first, second, third]) expect(isSessionFrozen(id)).toBe(true);
    releaseSession(first, "delete-second", false, "pending");
    for (const id of [first, second, third]) expect(isSessionFrozen(id)).toBe(true);
    releaseSession(second, "retry", false, "available");
    for (const id of [first, second, third]) expect(isSessionFrozen(id)).toBe(false);
    expect(isSessionRetired(first)).toBe(true); expect(isSessionRetired(second)).toBe(true);
    expect(isSessionRetired(third)).toBe(false);
    freezeSession(first, "commit"); releaseSession(third, "commit", true);
    releaseSession(second, "late", false, "available");
    for (const id of [first, second, third]) expect(isSessionFrozen(id)).toBe(true);
  });

  it("holds recovery ownership through a rename and notifies exactly once on release", () => {
    const first = crypto.randomUUID(), second = crypto.randomUUID();
    const versions: number[] = [];
    const unsubscribe = subscribeSessionRecoveries(() => versions.push(getSessionRecoveryVersion()));
    const release = beginSessionRecovery(first)!;
    replaceSessionRuntime(first, second);
    expect(isSessionRecovering(second)).toBe(true);
    expect(beginSessionRecovery(second)).toBeNull(); expect(beginSessionRecovery(first)).toBeNull();
    release(); release(); unsubscribe();
    expect(versions).toHaveLength(2); expect(versions[1]).toBe(versions[0] + 1);
    expect(isSessionRecovering(first)).toBe(false); expect(isSessionRecovering(second)).toBe(false);
    expect(beginSessionRecovery(first)).toBeNull();
    const next = beginSessionRecovery(second); expect(next).not.toBeNull(); next?.();
  });
});
