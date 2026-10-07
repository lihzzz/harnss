import type { GlobalShortcutSettings, QuickCaptureAction, ShortcutStatus } from "@shared/types/productivity";
import { GLOBAL_SHORTCUT_DEFAULTS } from "@shared/lib/productivity-settings";
import { ProductivityError } from "./productivity-errors";

export interface ShortcutRegistry {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
  isRegistered: (accelerator: string) => boolean;
}
export const QUICK_CAPTURE_ACTIONS: QuickCaptureAction[] = ["wake", "dictate", "analyzeClipboard"];

/** Keep old registrations until new registrations AND settings persistence succeed. */
export class GlobalShortcuts {
  private config: GlobalShortcutSettings = { ...GLOBAL_SHORTCUT_DEFAULTS };
  private bindings = new Map<string, QuickCaptureAction>();
  private errors = new Map<QuickCaptureAction, string>();
  constructor(private readonly registry: ShortcutRegistry, private readonly dispatch: (action: QuickCaptureAction) => void, private readonly platform: string) {}

  private canonical(accelerator: string): string {
    return accelerator.toLowerCase().replace(/commandorcontrol|cmdorctrl/g, this.platform === "darwin" ? "command" : "control")
      .replace(/cmd|meta|super/g, "command").replace(/ctrl/g, "control").replace(/option/g, "alt").split("+").sort().join("+");
  }
  private wanted(config: GlobalShortcutSettings): Map<string, QuickCaptureAction> {
    const keys = new Set<string>();
    const desired = new Map<string, QuickCaptureAction>();
    for (const action of QUICK_CAPTURE_ACTIONS) {
      const binding = config[action];
      if (!binding) continue;
      const key = this.canonical(binding);
      if (keys.has(key)) throw new ProductivityError("SHORTCUT_CONFLICT", "Two actions use the same shortcut");
      keys.add(key);
      const registeredBinding = [...this.bindings.keys()].find((existing) => this.canonical(existing) === key);
      if (config.enabled) desired.set(registeredBinding ?? binding, action);
    }
    return desired;
  }
  status(): ShortcutStatus[] {
    return QUICK_CAPTURE_ACTIONS.map((action) => {
      const configured = this.config[action];
      const binding = [...this.bindings.keys()].find((key) => this.bindings.get(key) === action);
      const registered = !!binding && this.registry.isRegistered(binding);
      const message = this.errors.get(action);
      return { action, configured, effective: registered ? binding! : null, registered,
        error: message ? { code: "SHORTCUT_CONFLICT", message, retryable: true } : null };
    });
  }
  initialize(config: GlobalShortcutSettings): void {
    this.config = { ...config };
    this.errors.clear();
    let desired: Map<string, QuickCaptureAction>;
    try { desired = this.wanted(config); }
    catch (error) { for (const action of QUICK_CAPTURE_ACTIONS) this.errors.set(action, error instanceof Error ? error.message : "Invalid shortcut"); return; }
    for (const [binding, action] of desired) {
      try {
        if (!this.registry.register(binding, () => this.trigger(binding))) throw new Error("Shortcut is already in use or unavailable on this desktop");
        this.bindings.set(binding, action);
      } catch (error) { this.errors.set(action, error instanceof Error ? error.message : "Shortcut unavailable"); }
    }
  }
  private trigger(binding: string): void { const action = this.bindings.get(binding); if (action) this.dispatch(action); }
  apply(config: GlobalShortcutSettings, persist: () => void): void {
    const desired = this.wanted(config);
    const added: string[] = [];
    try {
      for (const binding of desired.keys()) {
        if (this.bindings.has(binding)) continue;
        if (!this.registry.register(binding, () => this.trigger(binding))) throw new ProductivityError("SHORTCUT_CONFLICT", "Shortcut is already in use or unavailable on this desktop");
        added.push(binding);
      }
      persist();
    } catch (error) {
      for (const binding of added) this.registry.unregister(binding);
      throw error;
    }
    for (const binding of this.bindings.keys()) if (!desired.has(binding)) this.registry.unregister(binding);
    this.bindings = desired;
    this.config = { ...config };
    this.errors.clear();
  }
  dispose(): void { for (const binding of this.bindings.keys()) this.registry.unregister(binding); this.bindings.clear(); }
}
