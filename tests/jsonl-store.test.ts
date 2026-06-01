import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { JsonlStore } from "../src/persistence/jsonl-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonlStore", () => {
  test("appends and reloads events and turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-jsonl-"));
    tempDirs.push(dir);
    const store = new JsonlStore(dir);

    await store.appendEvent({ seq: 1, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: { text: "hello" } });
    await store.upsertTurn({ threadId: "thread-1", turnId: "turn-1", status: "running", startedAt: "2026-05-28T00:00:01.000Z" });

    const reloaded = new JsonlStore(dir);
    await expect(reloaded.readEvents()).resolves.toEqual([
      { seq: 1, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: { text: "hello" } }
    ]);
    await expect(reloaded.readTurns()).resolves.toEqual([
      { threadId: "thread-1", turnId: "turn-1", status: "running", startedAt: "2026-05-28T00:00:01.000Z" }
    ]);
  });
});
