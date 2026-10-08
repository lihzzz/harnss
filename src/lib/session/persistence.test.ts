import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedSession } from "@/types";
import { beginSessionRecovery, freezeSession, isSessionRetired, releaseSession, replaceSessionRuntime } from "./batch-runtime";
import { persistSessionReplacement, saveSessionSmart } from "./persistence";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const data: PersistedSession = { id: crypto.randomUUID(), projectId: "project", title: "Saved history", createdAt: 1, totalCost: 0, messages: [
    { id: "message", role: "user", content: "Original input", timestamp: 1 },
  ] };
  const next = { ...data, id: crypto.randomUUID(), conversationId: data.id };
  const api = {
    save: vi.fn<Window["claude"]["sessions"]["save"]>().mockResolvedValue({}),
    append: vi.fn<Window["claude"]["sessions"]["append"]>().mockResolvedValue({}),
  };
  vi.stubGlobal("window", { claude: { sessions: api } });
  return { data, next, api };
}

describe("renderer persistence during session replacement", () => {
  it("keeps the source writable when a replacement fails and retires it only after a successful retry", async () => {
    const { data, next, api } = fixture();
    api.save.mockResolvedValueOnce({ error: "disk full" });
    await expect(persistSessionReplacement(data.id, next)).rejects.toThrow("disk full");
    expect(isSessionRetired(data.id)).toBe(false);
    await saveSessionSmart(data);
    expect(api.save).toHaveBeenCalledWith(data, undefined);
    await persistSessionReplacement(data.id, next);
    expect(isSessionRetired(data.id)).toBe(true);
    api.save.mockClear(); api.append.mockClear();
    await saveSessionSmart(data);
    expect(api.save).not.toHaveBeenCalled(); expect(api.append).not.toHaveBeenCalled();
  });

  it("does not report an explicit replacement as saved when its source is frozen", async () => {
    const { data, next, api } = fixture();
    freezeSession(data.id, "deletion");
    await expect(persistSessionReplacement(data.id, next)).rejects.toThrow("no longer available");
    expect(api.save).not.toHaveBeenCalled(); expect(isSessionRetired(data.id)).toBe(false);
    releaseSession(data.id, "deletion", false, "available");
    await persistSessionReplacement(data.id, next);
    expect(api.save).toHaveBeenCalledWith(next, data.id);
  });

  it("suspends ordinary autosaves during recovery but allows its explicit snapshot", async () => {
    const { data, next, api } = fixture();
    const release = beginSessionRecovery(data.id)!;
    try {
      await saveSessionSmart(data);
      expect(api.save).not.toHaveBeenCalled();
      await persistSessionReplacement(data.id, next);
      await saveSessionSmart({ ...next, title: "Late autosave" });
      expect(api.save).toHaveBeenCalledOnce(); expect(api.append).not.toHaveBeenCalled();
    } finally { release(); }
    await saveSessionSmart({ ...next, title: "Current title" });
    expect(api.append).toHaveBeenCalledOnce();
  });

  it.each(["delete", "replace"] as const)("does not resurrect the old source through a full-save fallback after %s", async (action) => {
    const { data, next, api } = fixture();
    await saveSessionSmart(data);
    api.save.mockClear();
    let finish!: (result: { error: string }) => void;
    api.append.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = saveSessionSmart(data);
    if (action === "delete") { freezeSession(data.id, "delete"); releaseSession(data.id, "delete", true); }
    else replaceSessionRuntime(data.id, next.id);
    finish({ error: "append-before-save" });
    await expect(pending).rejects.toThrow("no longer available");
    expect(api.save).not.toHaveBeenCalled();
  });
});
