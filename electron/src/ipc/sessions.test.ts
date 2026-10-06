import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getProjectSessionsDir, getSessionFilePath } from "../lib/data-dir";
import { register } from "./sessions";

type IpcHandler = (event: unknown, ...args: unknown[]) => Promise<unknown>;

const state = vi.hoisted(() => ({
  userData: "",
  handlers: new Map<string, IpcHandler>(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.userData },
  BrowserWindow: {},
  dialog: {},
  ipcMain: { handle: (channel: string, handler: IpcHandler) => state.handlers.set(channel, handler) },
}));
vi.mock("../lib/error-utils", () => ({ reportError: (_label: string, error: unknown) => String(error) }));

function invoke(channel: string, ...args: unknown[]) {
  const handler = state.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return handler(undefined, ...args);
}

function session(id: string, timestamp = 100) {
  return {
    id,
    conversationId: "original",
    projectId: "project",
    title: "Same title",
    engine: "codex",
    codexThreadId: "thread",
    createdAt: 1,
    messages: [{ id: "user", role: "user", content: "hello", timestamp }],
  };
}

beforeEach(async () => {
  state.userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harnss-sessions-"));
  state.handlers.clear();
  register();
});

afterEach(async () => {
  await fs.promises.rm(state.userData, { recursive: true, force: true });
});

describe("session persistence across runtime restarts", () => {
  it("replaces both old files after saving the resumed session, including repeated resumes", async () => {
    await invoke("sessions:save", session("original"));
    await invoke("sessions:save", session("resumed", 200), "original");
    await invoke("sessions:save", session("resumed-again", 300), "resumed");

    expect((await fs.promises.readdir(getProjectSessionsDir("project"))).sort()).toEqual([
      "resumed-again.json", "resumed-again.meta.json",
    ]);
    expect(await invoke("sessions:load", "project", "resumed-again")).toMatchObject(session("resumed-again", 300));
  });

  it("keeps the original history when writing the replacement fails", async () => {
    await invoke("sessions:save", session("original"));
    await fs.promises.mkdir(getSessionFilePath("project", "resumed"));

    expect(await invoke("sessions:save", session("resumed", 200), "original")).toHaveProperty("error");
    expect(await invoke("sessions:load", "project", "original")).toMatchObject(session("original"));
    expect(fs.existsSync(getSessionFilePath("project", "original").replace(/\.json$/, ".meta.json"))).toBe(true);
  });

  it("does not delete a session when the runtime ID stays the same", async () => {
    await invoke("sessions:save", session("original"), "original");
    expect(await invoke("sessions:load", "project", "original")).toMatchObject(session("original"));
  });

  it("keeps the old snapshot until the replacement metadata is also saved", async () => {
    await invoke("sessions:save", session("original"));
    await fs.promises.mkdir(getSessionFilePath("project", "resumed").replace(/\.json$/, ".meta.json"));

    expect(await invoke("sessions:save", session("resumed", 200), "original")).toHaveProperty("error");
    expect(await invoke("sessions:load", "project", "original")).toMatchObject(session("original"));
  });

  it("handles an old save already in flight when the runtime is replaced", async () => {
    await invoke("sessions:save", session("original"));
    await Promise.all([
      invoke("sessions:save", session("original", 200)),
      invoke("sessions:save", session("resumed", 300), "original"),
    ]);

    expect(await invoke("sessions:load", "project", "original")).toBeNull();
    expect(await invoke("sessions:load", "project", "resumed")).toMatchObject(session("resumed", 300));
  });

  it("shows the newest legacy snapshot once, while keeping unrelated chats with the same title", async () => {
    await invoke("sessions:save", session("original", 100));
    await invoke("sessions:save", session("resumed", 200));
    await invoke("sessions:save", session("latest", 300));
    await invoke("sessions:save", { ...session("separate", 250), conversationId: "separate", codexThreadId: "another-thread" });

    expect(await invoke("sessions:list", "project")).toEqual([
      expect.objectContaining({ id: "latest" }),
      expect.objectContaining({ id: "separate" }),
    ]);
    // Listing only chooses a snapshot; it does not remove historical files.
    expect(fs.existsSync(getSessionFilePath("project", "original"))).toBe(true);
  });

  it("uses the most recently saved snapshot when user activity timestamps are equal", async () => {
    await invoke("sessions:save", session("a-old"));
    const oldMeta = getSessionFilePath("project", "a-old").replace(/\.json$/, ".meta.json");
    await fs.promises.utimes(oldMeta, new Date(0), new Date(0));
    await invoke("sessions:save", session("z-new"));

    expect(await invoke("sessions:list", "project")).toEqual([expect.objectContaining({ id: "z-new" })]);
  });

  it("recognizes Codex snapshots that predate conversationId and metadata sidecars", async () => {
    const { conversationId: _conversationId, ...legacy } = session("legacy");
    await fs.promises.writeFile(getSessionFilePath("project", "legacy"), JSON.stringify(legacy));
    await invoke("sessions:save", session("latest", 200));

    expect(await invoke("sessions:list", "project")).toEqual([expect.objectContaining({ id: "latest" })]);
  });

  it("groups ACP runtimes by conversation while keeping engines separate", async () => {
    await invoke("sessions:save", { ...session("acp-old"), engine: "acp", codexThreadId: undefined });
    await invoke("sessions:save", { ...session("acp-new", 200), engine: "acp", codexThreadId: undefined });
    await invoke("sessions:save", { ...session("claude", 150), engine: "claude", codexThreadId: undefined });

    expect(await invoke("sessions:list", "project")).toEqual([
      expect.objectContaining({ id: "acp-new" }),
      expect.objectContaining({ id: "claude" }),
    ]);
  });

  it("removes all snapshots when the user deletes the conversation, without touching other chats", async () => {
    await invoke("sessions:save", session("original"));
    await invoke("sessions:save", session("latest", 200));
    await invoke("sessions:save", { ...session("separate"), conversationId: "separate", codexThreadId: "another-thread" });

    expect(await invoke("sessions:delete", "project", "latest")).toEqual({ ok: true });
    expect(await invoke("sessions:list", "project")).toEqual([expect.objectContaining({ id: "separate" })]);
    expect(fs.existsSync(getSessionFilePath("project", "original"))).toBe(false);
  });

  it("searches the newest snapshot only", async () => {
    await invoke("sessions:save", session("original"));
    await invoke("sessions:save", session("latest", 200));

    expect(await invoke("sessions:search", { projectIds: ["project"], query: "hello" })).toMatchObject({
      messageResults: [expect.objectContaining({ sessionId: "latest" })],
    });
    expect(await invoke("sessions:search", { projectIds: ["project"], query: "Same title" })).toMatchObject({
      sessionResults: [expect.objectContaining({ sessionId: "latest" })],
    });
  });
});
