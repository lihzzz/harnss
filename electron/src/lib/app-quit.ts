export interface ManagedQuitActions {
  stop: () => Promise<void>;
  onFailure: (error: unknown) => Promise<"retry" | "cancel" | "force">;
}

/** A failed stop must never accidentally become an unconditional application exit. */
export async function prepareManagedQuit(actions: ManagedQuitActions): Promise<boolean> {
  for (;;) {
    try { await actions.stop(); return true; }
    catch (error) {
      const decision = await actions.onFailure(error);
      if (decision === "cancel") return false;
      if (decision === "force") return true;
    }
  }
}
