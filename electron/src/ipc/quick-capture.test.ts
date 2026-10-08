import { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstalledAgent } from "@shared/types/registry";
import { register } from "./quick-capture";
import { QuickCapture } from "../lib/quick-capture";
import { GlobalShortcuts } from "../lib/global-shortcuts";

type Handler = (event: unknown, request?: unknown) => unknown;
const fixture = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  projects: [{ id: "project", name: "Fixture", path: "/fixture", createdAt: 1 }],
  agent: { id: "agent", name: "Fixture", engine: "claude" } as InstalledAgent | null,
  blocked: false,
  auth: vi.fn(async () => true),
  initialize: vi.fn(async () => {}),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, handler: Handler) => fixture.handlers.set(name, handler) },
  BrowserWindow: class { webContents = { mainFrame: {} }; isDestroyed() { return false; } },
}));
vi.mock("./projects", () => ({ readProjects: () => fixture.projects }));
vi.mock("../lib/agent-registry", () => ({ getAgent: (id: string) => fixture.agent?.id === id ? fixture.agent : null }));
vi.mock("../lib/session-service", () => ({ getSessionRepository: () => ({ initialize: fixture.initialize, isProjectBlocked: () => fixture.blocked }) }));
vi.mock("../lib/error-utils", () => ({ reportError: vi.fn() }));
vi.mock("./claude-sessions", () => ({ hasConfiguredClaudeAccount: fixture.auth }));
vi.mock("./codex-sessions", () => ({ hasConfiguredCodexAccount: fixture.auth }));

const target = { projectId: "project", agentId: "agent" };
let service: QuickCapture;
let event: { sender: BrowserWindow["webContents"]; senderFrame: BrowserWindow["webContents"]["mainFrame"] };
beforeEach(() => {
  vi.useFakeTimers();
  fixture.projects = [{ id: "project", name: "Fixture", path: "/fixture", createdAt: 1 }];
  fixture.agent = { id: "agent", name: "Fixture", engine: "claude" };
  fixture.blocked = false; fixture.auth.mockReset().mockResolvedValue(true); fixture.initialize.mockClear();
  service = new QuickCapture(() => {});
  const window = new BrowserWindow();
  event = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  register(() => window, service, new GlobalShortcuts({ register: () => true, unregister: () => {}, isRegistered: () => true }, () => {}, "darwin"));
});
afterEach(() => { service.dispose(); vi.useRealTimers(); });

describe("quick capture target IPC", () => {
  const invoke = (requestId: string, sender: unknown = event) => fixture.handlers.get("quick-capture:check-target")!(sender, { requestId, target });
  it("checks the selected account only for an active request from the main renderer", async () => {
    const request = service.capture("analyzeClipboard", () => "fixture", target);
    expect(await invoke(request.requestId, { ...event, senderFrame: {} })).toMatchObject({ ok: false, error: { code: "FORBIDDEN_SENDER" } });
    expect(fixture.auth).not.toHaveBeenCalled();
    expect(await invoke(request.requestId)).toEqual({ ok: true, value: { ready: true } });
    expect(fixture.auth).toHaveBeenCalledExactlyOnceWith("/fixture");
    expect(fixture.initialize).toHaveBeenCalled();
  });

  it.each(["cancelled", "expired", "UI timeout", "dispatched"] as const)("rejects a late authentication result after the request is %s", async (change) => {
    let resolve!: (ready: boolean) => void;
    fixture.auth.mockReturnValue(new Promise<boolean>((done) => { resolve = done; }));
    const request = service.capture("analyzeClipboard", () => "fixture", target);
    const pending = invoke(request.requestId);
    await vi.advanceTimersByTimeAsync(0);
    if (change === "cancelled") service.update({ requestId: request.requestId, state: "cancelled" });
    else if (change === "expired") await vi.advanceTimersByTimeAsync(300_001);
    else if (change === "UI timeout") await vi.advanceTimersByTimeAsync(5_001);
    else { service.update({ requestId: request.requestId, state: "ready" }); service.update({ requestId: request.requestId, state: "dispatched" }); }
    resolve(true);
    expect(await pending).toMatchObject({ ok: false });
  });

  it.each(["project removed", "project blocked", "project moved", "agent removed", "engine changed"] as const)("revalidates %s after asynchronous authentication", async (change) => {
    fixture.auth.mockImplementation(async () => {
      if (change === "project removed") fixture.projects = [];
      if (change === "project blocked") fixture.blocked = true;
      if (change === "project moved") fixture.projects[0].path = "/other";
      if (change === "agent removed") fixture.agent = null;
      if (change === "engine changed" && fixture.agent) fixture.agent.engine = "codex";
      return true;
    });
    const request = service.capture("analyzeClipboard", () => "fixture", target);
    expect(await invoke(request.requestId)).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
  });

  it("rejects a disabled project before checking accounts and again at the dispatch claim", async () => {
    const request = service.capture("analyzeClipboard", () => "fixture", target);
    fixture.blocked = true;
    expect(await invoke(request.requestId)).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    expect(fixture.auth).not.toHaveBeenCalled();
    fixture.blocked = false;
    expect(await invoke(request.requestId)).toMatchObject({ ok: true });
    service.update({ requestId: request.requestId, state: "ready" });
    fixture.blocked = true;
    const result = await fixture.handlers.get("quick-capture:update")!(event, { requestId: request.requestId, state: "dispatched" });
    expect(result).toMatchObject({ ok: false, error: { code: "INVALID_TARGET" } });
    expect(service.pending()?.dispatchAccepted).toBe(false);
  });
});
