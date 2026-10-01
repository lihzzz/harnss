import fs from "fs";

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    await fs.promises.writeFile(tempPath, JSON.stringify(value), "utf-8");
    await fs.promises.rename(tempPath, filePath);
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined);
  }
}
