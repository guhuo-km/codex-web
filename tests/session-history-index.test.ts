import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { listLocalCodexThreads } from "../src/codex/session-history.js";

const createReadStreamMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  createReadStreamMock.mockImplementation(actual.createReadStream);
  return {
    ...actual,
    createReadStream: createReadStreamMock
  };
});

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  createReadStreamMock.mockClear();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("session history index", () => {
  test("reuses cached summaries for unchanged rollout files", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
    tempDirs.push(codexHome, dataDir);
    await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000001", "hello");
    await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000002", "world");

    const first = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    expect(first).toHaveLength(2);
    expect(createReadStreamMock).toHaveBeenCalledTimes(2);

    createReadStreamMock.mockClear();
    const second = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    expect(second).toHaveLength(2);
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  test("re-parses only changed rollout files", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
    tempDirs.push(codexHome, dataDir);
    const firstFile = await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000001", "hello");
    await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000002", "world");

    await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    expect(createReadStreamMock).toHaveBeenCalledTimes(2);

    createReadStreamMock.mockClear();
    await writeFile(firstFile, [
      JSON.stringify({
        timestamp: "2026-06-01T00:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "019e70f7-3103-7e52-b519-000000000001",
          cwd: "D:\\codex-web",
          timestamp: "2026-06-01T00:00:00.000Z"
        }
      }),
      JSON.stringify({
        timestamp: "2026-06-01T00:05:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "hello again" }
      })
    ].join("\n"), "utf8");

    const second = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    expect(second).toHaveLength(2);
    expect(createReadStreamMock).toHaveBeenCalledTimes(1);
    expect(second.find((thread) => thread.id === "019e70f7-3103-7e52-b519-000000000001")).toEqual(
      expect.objectContaining({ preview: "hello again" })
    );
  });

  test("rebuilds from a corrupt session index", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
    tempDirs.push(codexHome, dataDir);
    await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000001", "hello");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "session-index.json"), "not valid json", "utf8");

    const threads = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });

    expect(threads).toHaveLength(1);
    expect(threads[0]).toEqual(expect.objectContaining({
      id: "019e70f7-3103-7e52-b519-000000000001",
      preview: "hello"
    }));
  });

  test("drops deleted rollout files from the index", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-home-"));
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
    tempDirs.push(codexHome, dataDir);
    const filePath = await createRollout(codexHome, "019e70f7-3103-7e52-b519-000000000001", "hello");

    await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    await rm(filePath, { force: true });
    const threads = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });

    expect(threads).toHaveLength(0);
  });
});

async function createRollout(codexHome: string, id: string, message: string): Promise<string> {
  const sessionDir = join(codexHome, "sessions", "2026", "06", "01");
  await mkdir(sessionDir, { recursive: true });
  const filePath = join(sessionDir, `rollout-2026-06-01T00-00-00-${id}.jsonl`);
  await writeFile(filePath, [
    JSON.stringify({
      timestamp: "2026-06-01T00:00:00.000Z",
      type: "session_meta",
      payload: {
        id,
        cwd: "D:\\codex-web",
        timestamp: "2026-06-01T00:00:00.000Z"
      }
    }),
    JSON.stringify({
      timestamp: "2026-06-01T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message }
    })
  ].join("\n"), "utf8");
  return filePath;
}
