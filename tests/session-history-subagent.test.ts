import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { listLocalCodexThreads } from "../src/codex/session-history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("listLocalCodexThreads subagent metadata", () => {
  test("reads subagent parent and role metadata from Codex rollout files", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-codex-home-"));
    const indexDataDir = await mkdtemp(join(tmpdir(), "codex-web-index-"));
    tempDirs.push(codexHome, indexDataDir);
    const sessionDir = join(codexHome, "sessions", "2026", "07", "03");
    await mkdir(sessionDir, { recursive: true });

    await writeFile(join(sessionDir, "rollout-2026-07-03T01-39-33-019f23ea-1c3e-7071-bde9-a111038a3691.jsonl"), [
      JSON.stringify({
        timestamp: "2026-07-02T17:39:33.045Z",
        type: "session_meta",
        payload: {
          id: "019f23ea-1c3e-7071-bde9-a111038a3691",
          parent_thread_id: "019f23e9-8b57-7f72-8f10-6f35f0100fa7",
          cwd: "D:\\codex-web\\workspace\\project-7",
          timestamp: "2026-07-02T17:39:33.045Z",
          thread_source: "subagent",
          agent_nickname: "Raman",
          agent_role: "explorer"
        }
      }),
      JSON.stringify({
        timestamp: "2026-07-02T17:39:34.338Z",
        type: "event_msg",
        payload: { type: "user_message", message: "只读探索任务" }
      })
    ].join("\n"), "utf8");

    const threads = await listLocalCodexThreads({
      codexHome,
      indexDataDir,
      cwd: "D:\\codex-web\\workspace\\project-7"
    });

    expect(threads).toEqual([
      expect.objectContaining({
        id: "019f23ea-1c3e-7071-bde9-a111038a3691",
        parentThreadId: "019f23e9-8b57-7f72-8f10-6f35f0100fa7",
        threadSource: "subagent",
        agentNickname: "Raman",
        agentRole: "explorer",
        isSubagent: true
      })
    ]);
  });
});
