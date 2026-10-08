import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { writeJsonAtomically } from "../atomic-file";
import { SessionWriteQueue } from "../session-write-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("SessionWriteQueue", () => {
  it("replaces JSON atomically and removes the temporary file", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "harnss-session-"));
    const filePath = path.join(dir, "session.json");

    await writeJsonAtomically(filePath, { version: 2 });

    expect(JSON.parse(await fs.promises.readFile(filePath, "utf-8"))).toEqual({ version: 2 });
    expect((await fs.promises.readdir(dir)).filter((file) => file.includes(".tmp-")).length).toBe(0);
    await fs.promises.rm(dir, { recursive: true, force: true });
  });

  it("runs writes serially and keeps only the newest pending save", async () => {
    const queue = new SessionWriteQueue();
    const first = deferred();
    const calls: string[] = [];

    const firstSave = queue.enqueue("project/session", async () => {
      calls.push("first");
      await first.promise;
    }, "save");
    const secondSave = queue.enqueue("project/session", async () => {
      calls.push("second");
    }, "save");
    const newestSave = queue.enqueue("project/session", async () => {
      calls.push("newest");
    }, "save");

    await Promise.resolve();
    expect(calls).toEqual(["first"]);
    first.resolve();

    await Promise.all([firstSave, secondSave, newestSave]);
    expect(calls).toEqual(["first", "newest"]);
  });

  it("does not coalesce a metadata operation into a save", async () => {
    const queue = new SessionWriteQueue();
    const calls: string[] = [];

    await Promise.all([
      queue.enqueue("project/session", async () => { calls.push("save"); }, "save"),
      queue.enqueue("project/session", async () => { calls.push("meta"); }),
      queue.enqueue("project/session", async () => { calls.push("save-2"); }, "save"),
    ]);

    expect(calls).toEqual(["save", "meta", "save-2"]);
  });

  it("continues with later writes after a failed operation", async () => {
    const queue = new SessionWriteQueue();
    const calls: string[] = [];
    const failed = queue.enqueue("project/session", async () => {
      calls.push("failed");
      throw new Error("disk full");
    });
    const next = queue.enqueue("project/session", async () => {
      calls.push("next");
    });

    await expect(failed).rejects.toThrow("disk full");
    await expect(next).resolves.toBeUndefined();
    expect(calls).toEqual(["failed", "next"]);
  });
});
