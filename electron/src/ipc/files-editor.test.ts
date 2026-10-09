import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./files";

type EditorOptions = { filePath: string; line?: number; editor?: string };
type Handler = (event: unknown, options: EditorOptions) => Promise<unknown>;
const state = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  launch: vi.fn<(...args: unknown[]) => Promise<string>>(),
  openPath: vi.fn<(file: string) => Promise<string>>(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (name: string, handler: Handler) => state.handlers.set(name, handler) },
  shell: { openPath: state.openPath },
}));
vi.mock("../lib/command-launch", () => ({ execFileExecutable: state.launch }));
vi.mock("../lib/app-settings", () => ({ getAppSetting: () => "auto" }));
vi.mock("../lib/logger", () => ({ log: vi.fn() }));
vi.mock("../lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("../lib/error-utils", () => ({ reportError: (_label: string, error: unknown) => String(error) }));

const open = (options: EditorOptions) => state.handlers.get("file:open-in-editor")!(null, options);
beforeEach(() => {
  state.launch.mockReset(); state.openPath.mockReset();
  register(() => null);
});
describe("cross-platform editor launch", () => {
  it("decodes a Windows file URL and keeps path/line as one CLI argument", async () => {
    state.launch.mockResolvedValue("");
    expect(await open({ filePath: "file:///C:/My%20Project/%E6%96%87%E4%BB%B6.ts", line: 12, editor: "code" }))
      .toEqual({ ok: true, editor: "code" });
    expect(state.launch).toHaveBeenCalledWith("code", ["--goto", "C:/My Project/文件.ts:12"], expect.objectContaining({ timeout: 3000 }));
  });
  it("propagates OS association failures instead of reporting success", async () => {
    state.launch.mockRejectedValue(new Error("not installed"));
    state.openPath.mockResolvedValue("No application associated with this file");
    expect(await open({ filePath: "/tmp/unassociated-file" })).toEqual({ error: expect.stringContaining("No application associated") });
  });
  it("falls back to the OS association when no editor is available", async () => {
    state.launch.mockRejectedValue(new Error("not installed"));
    state.openPath.mockResolvedValue("");
    expect(await open({ filePath: "/tmp/file" })).toEqual({ ok: true, editor: "default" });
  });
});
