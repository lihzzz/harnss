import type { BrowserWindow } from "electron";
import { ipcMain } from "electron";
import { getAppSettings, setAppSettings, type AppSettings } from "../lib/app-settings";
import { reportError } from "../lib/error-utils";
import { safeSend } from "../lib/safe-send";
import type { GlobalShortcutSettings } from "@shared/types/productivity";
import { mergeGlobalShortcuts } from "@shared/lib/productivity-settings";
import { assertMainRenderer } from "../lib/productivity-ipc";
import { getAgent } from "../lib/agent-registry";
import { readProjects } from "./projects";
import { isRecord, ProductivityError } from "../lib/productivity-errors";

// Listeners notified when any setting changes.
type SettingsListener = (settings: AppSettings) => void;
const listeners: SettingsListener[] = [];
let applyShortcuts: ((settings: GlobalShortcutSettings, persist: () => void) => void) | null = null;
export function configureShortcutSettings(apply: NonNullable<typeof applyShortcuts>): void { applyShortcuts = apply; }

export function onSettingsChanged(cb: SettingsListener): void {
  listeners.push(cb);
}

export function register(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle("settings:get", () => {
    try {
      return getAppSettings();
    } catch (err) {
      reportError("SETTINGS:GET_ERR", err);
      return null;
    }
  });

  ipcMain.handle("settings:set", (event, patch: Partial<AppSettings>) => {
    try {
      assertMainRenderer(event, getMainWindow);
      if (!isRecord(patch)) throw new ProductivityError("INVALID_ARGUMENT");
      if (patch.quickCaptureTarget && (!getAgent(patch.quickCaptureTarget.agentId) || !readProjects().some((project) => project.id === patch.quickCaptureTarget?.projectId))) throw new ProductivityError("INVALID_TARGET");
      let next = getAppSettings();
      if (patch.globalShortcuts && applyShortcuts) {
        applyShortcuts(mergeGlobalShortcuts(patch.globalShortcuts, next.globalShortcuts), () => { next = setAppSettings(patch); });
      } else next = setAppSettings(patch);
      // Notify in-process listeners.
      for (const cb of listeners) {
        try { cb(next); } catch (error) { reportError("SETTINGS:LISTENER_ERR", error); }
      }
      // Notify renderer so reactive subscribers update without polling
      safeSend(getMainWindow, "settings:changed", next);
      return { ok: true };
    } catch (err) {
      const errMsg = reportError("SETTINGS:SET_ERR", err);
      return { error: errMsg };
    }
  });
}
