import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./projects";
import { configureSessionStopper, getSessionRepository } from "../lib/session-service";
import { readProjectCatalog, writeProjectCatalog } from "../lib/project-catalog";

type Handler = (event: unknown, id: string) => unknown;
const state = vi.hoisted(() => ({ root: "", handlers: new Map<string, Handler>() }));
vi.mock("electron", () => ({ BrowserWindow: {}, dialog: {}, ipcMain: { handle: (name: string, handler: Handler) => state.handlers.set(name, handler) } }));
vi.mock("../lib/data-dir", () => ({ getDataDir: () => state.root }));
vi.mock("../lib/error-utils", () => ({ reportError: (_label: string, error: unknown) => String(error) }));
vi.mock("../lib/posthog", () => ({ captureEvent: vi.fn() }));
const frame = {}, contents = { mainFrame: frame }, window = { isDestroyed: () => false, webContents: contents };
const event = { sender: contents, senderFrame: frame };
const original = { id: "session", projectId: "project", title: "Saved", createdAt: 1, messages: [] };
const remove = (id = "project", sender: unknown = event) => state.handlers.get("projects:delete")!(sender, id);
beforeEach(async () => {
  state.root = await fs.mkdtemp(path.join(os.tmpdir(), "harnss-project-ipc-"));
  writeProjectCatalog(state.root, ["project", "other"].map((id) => ({ id, name: id, path: `/${id}`, createdAt: 1 })));
  await getSessionRepository().save(original);
  configureSessionStopper(async () => {});
  register(() => window as unknown as BrowserWindow);
});
afterEach(async () => { configureSessionStopper(async () => {}); await fs.rm(state.root, { recursive: true, force: true }); });

describe("project deletion IPC", () => {
  it("deletes source data through the repository and permits an idempotent repeat", async () => {
    expect(await remove()).toEqual({ ok: true }); expect(await remove()).toEqual({ ok: true });
    expect(readProjectCatalog(state.root).map((project) => project.id)).toEqual(["other"]);
    await expect(getSessionRepository().save(original)).rejects.toMatchObject({ code: "PROJECT_DELETED" });
  });

  it("refuses unknown projects, traversal and webview senders without changing data", async () => {
    expect(await remove("missing")).toEqual({ error: expect.stringContaining("project no longer exists") });
    expect(await remove("../outside")).toEqual({ error: expect.stringContaining("Invalid project or session ID") });
    expect(await remove("project", { sender: {}, senderFrame: frame })).toEqual({ error: expect.stringContaining("FORBIDDEN_SENDER") });
    expect(await remove("project", { sender: contents, senderFrame: {} })).toEqual({ error: expect.stringContaining("FORBIDDEN_SENDER") });
    expect(readProjectCatalog(state.root)).toHaveLength(2);
    expect(await getSessionRepository().load("project", "session")).not.toBeNull();
    await expect(fs.access(path.join(state.root, "sessions/.project-deletions"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns stop failures and leaves the catalog entry and source available for retry", async () => {
    configureSessionStopper(async () => { throw new Error("fixture stop failed"); });
    expect(await remove()).toEqual({ error: expect.stringContaining("fixture stop failed") });
    expect(readProjectCatalog(state.root)).toHaveLength(2);
    expect(await getSessionRepository().load("project", "session")).not.toBeNull();
    configureSessionStopper(async () => {});
    expect(await remove()).toEqual({ ok: true });
  });
});
