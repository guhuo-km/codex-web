import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { listLocalCodexThreads } from "../src/codex/session-history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("listLocalCodexThreads concurrency", () => {
  test("limits concurrent rollout file reads to avoid exhausting file handles", async () => {
    const codexHome = await mkdirTempCodexHome();
    const sessionDir = join(codexHome, "sessions", "2026", "06", "01");
    await mkdir(sessionDir, { recursive: true });
    const filler = Array.from({ length: 2000 }, (_, line) => JSON.stringify({
      timestamp: "2026-06-01T00:00:02.000Z",
      type: "noop",
      payload: { line, text: "x".repeat(40) }
    })).join("\n");

    await Promise.all(Array.from({ length: 120 }, async (_, index) => {
      const id = `019e70f7-3103-7e52-b519-${index.toString().padStart(12, "0")}`;
      await writeFile(join(sessionDir, `rollout-2026-06-01T00-00-00-${id}.jsonl`), [
        JSON.stringify({
          timestamp: "2026-06-01T00:00:00.000Z",
          type: "session_meta",
          payload: {
            id,
            cwd: "D:\\codex-web",
            timestamp: "2026-06-01T00:00:00.000Z"
          }
        }),
        filler
      ].join("\n"), "utf8");
    }));

    let maxActiveRequests = 0;
    const timer = setInterval(() => {
      maxActiveRequests = Math.max(maxActiveRequests, activeRequestCount());
    }, 0);
    const threads = await listLocalCodexThreads({ codexHome, cwd: "D:\\codex-web", limit: 120 });
    clearInterval(timer);

    expect(threads).toHaveLength(120);
    expect(maxActiveRequests).toBeLessThanOrEqual(48);
  });
});

function activeRequestCount(): number {
  return ((process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.() ?? []).length;
}

async function mkdirTempCodexHome(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  const dir = await mkdtemp(join(tmpdir(), "codex-web-session-history-"));
  tempDirs.push(dir);
  return dir;
}
