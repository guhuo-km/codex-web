import { describe, expect, test } from "vitest";
import { groupThreadsByWorkspace } from "../src/workspaces/workspace-index.js";

describe("groupThreadsByWorkspace", () => {
  test("groups threads by cwd and sorts workspaces and threads by updatedAt desc", () => {
    const result = groupThreadsByWorkspace([
      { id: "a", cwd: "D:\\repo-a", preview: "old", updatedAt: 10, status: "notLoaded" },
      { id: "b", cwd: "D:\\repo-b", preview: "new", updatedAt: 30, status: "running" },
      { id: "c", cwd: "D:\\repo-a", preview: "latest a", updatedAt: 20, status: "completed" }
    ]);

    expect(result).toEqual([
      { cwd: "D:\\repo-b", name: "repo-b", updatedAt: 30, runningCount: 1, threads: [expect.objectContaining({ id: "b" })] },
      { cwd: "D:\\repo-a", name: "repo-a", updatedAt: 20, runningCount: 0, threads: [expect.objectContaining({ id: "c" }), expect.objectContaining({ id: "a" })] }
    ]);
  });
});
