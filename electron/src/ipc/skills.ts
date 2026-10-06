import { ipcMain } from "electron";
import { listInstalledSkills } from "../lib/skills";

export function register(): void {
  ipcMain.handle("skills:list", async () => listInstalledSkills());
}
