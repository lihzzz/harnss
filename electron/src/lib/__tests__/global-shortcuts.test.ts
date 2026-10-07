import { describe, expect, it, vi } from "vitest";
import { GlobalShortcuts } from "../global-shortcuts";
import { GLOBAL_SHORTCUT_DEFAULTS } from "@shared/lib/productivity-settings";

function setup() {
  const registered = new Map<string, () => void>();
  const registry = {
    register: vi.fn((key: string, cb: () => void) => { if (key === "Taken") return false; registered.set(key, cb); return true; }),
    unregister: vi.fn((key: string) => { registered.delete(key); }),
    isRegistered: (key: string) => registered.has(key),
  };
  const dispatch = vi.fn();
  const shortcuts = new GlobalShortcuts(registry, dispatch, "darwin");
  const config = { ...GLOBAL_SHORTCUT_DEFAULTS, enabled: true };
  shortcuts.initialize(config);
  return { registered, registry, dispatch, shortcuts, config };
}

describe("GlobalShortcuts", () => {
  it("keeps old registrations and settings when any new combination is unavailable", () => {
    const { registered, shortcuts, config, dispatch } = setup();
    const persist = vi.fn();
    expect(() => shortcuts.apply({ ...config, wake: "Alt+Space", dictate: "Taken" }, persist)).toThrow();
    expect(persist).not.toHaveBeenCalled();
    expect([...registered.keys()]).toEqual([config.wake]);
    registered.get(config.wake!)?.();
    expect(dispatch).toHaveBeenCalledWith("wake");
  });
  it("rolls back newly registered combinations after a disk failure", () => {
    const { registered, shortcuts, config } = setup();
    expect(() => shortcuts.apply({ ...config, wake: "Alt+Space" }, () => { throw new Error("disk full"); })).toThrow("disk full");
    expect([...registered.keys()]).toEqual([config.wake]);
    expect(shortcuts.status()[0].registered).toBe(true);
  });
  it("swaps two actions without unregistering their shared physical combinations", () => {
    const { registered, registry, shortcuts, config, dispatch } = setup();
    shortcuts.apply({ ...config, dictate: "Alt+D" }, () => {});
    shortcuts.apply({ ...config, wake: "Alt+D", dictate: config.wake }, () => {});
    registered.get("Alt+D")?.();
    registered.get(config.wake!)?.();
    expect(dispatch.mock.calls).toEqual([["wake"], ["dictate"]]);
    expect(registry.unregister).not.toHaveBeenCalled();
  });
  it("reuses physical aliases, rejects duplicate actions and releases disabled bindings", () => {
    const { registered, registry, shortcuts, config } = setup();
    shortcuts.apply({ ...config, wake: "Cmd+Shift+Space" }, () => {});
    expect(registry.register).toHaveBeenCalledTimes(1);
    expect(shortcuts.status()[0]).toMatchObject({ configured: "Cmd+Shift+Space", registered: true });
    expect(() => shortcuts.apply({ ...config, dictate: "Shift+Command+Space" }, () => {})).toThrow();
    shortcuts.apply({ ...config, enabled: false }, () => {});
    expect(registered.size).toBe(0);
  });
  it("reports startup conflicts without claiming a failed binding is effective", () => {
    const { shortcuts, config } = setup();
    shortcuts.dispose();
    shortcuts.initialize({ ...config, wake: "Taken" });
    expect(shortcuts.status()[0]).toMatchObject({ effective: null, registered: false, error: { code: "SHORTCUT_CONFLICT" } });
  });
});
