import { describe, expect, test } from "vitest";
import { allRunningTasks, normalizeThreadGoal } from "../web/src/App.js";
import type { TaskSummary } from "../web/src/types.js";

describe("running task selection", () => {
  test("prefers server running turns over stale local optimistic turns", () => {
    const serverTask = task("thread-1", "server-turn", "2026-05-31T00:00:05.000Z");
    const localTask = task("thread-1", "local-turn", "2026-05-31T00:00:00.000Z");

    expect(allRunningTasks([serverTask], { "thread-1": localTask })).toEqual([
      expect.objectContaining({ threadId: "thread-1", turnId: "server-turn" })
    ]);
  });
});

describe("thread goal normalization", () => {
  test("treats complete goals as cleared for the UI", () => {
    expect(normalizeThreadGoal({
      threadId: "thread-1",
      objective: "检查服务器",
      status: "complete"
    })).toBeNull();
  });

  test("keeps active goals visible for the UI", () => {
    expect(normalizeThreadGoal({
      threadId: "thread-1",
      objective: "检查服务器",
      status: "active"
    })).toEqual(expect.objectContaining({
      threadId: "thread-1",
      objective: "检查服务器",
      status: "active"
    }));
  });
});

function task(threadId: string, turnId: string, startedAt: string): TaskSummary {
  return {
    threadId,
    turnId,
    status: "running",
    startedAt,
    lastEventAt: startedAt,
    lastSeq: 1,
    eventCount: 1
  };
}
