import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { ToolExplanationStore } from "../src/tool-explanations/tool-explanation-store.js";

describe("ToolExplanationStore", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-tool-explanations-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("keeps command explanations available after recreating the store", async () => {
    const identity = {
      threadId: "thread-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      command: "Get-Content -Raw package.json"
    };

    await new ToolExplanationStore(dataDir).set(identity, "读取 package.json 的完整文本。");

    await expect(new ToolExplanationStore(dataDir).get(identity)).resolves.toBe("读取 package.json 的完整文本。");
  });

  test("prunes old explanations when the file exceeds its size limit", async () => {
    const store = new ToolExplanationStore(dataDir, 900);
    await store.set({
      threadId: "thread-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      command: "first"
    }, "第一条解释".repeat(30));
    await store.set({
      threadId: "thread-1",
      turnId: "turn-2",
      toolCallId: "tool-2",
      command: "second"
    }, "第二条解释".repeat(30));

    await expect(store.get({
      threadId: "thread-1",
      turnId: "turn-1",
      toolCallId: "tool-1",
      command: "first"
    })).resolves.toBeUndefined();
    await expect(store.get({
      threadId: "thread-1",
      turnId: "turn-2",
      toolCallId: "tool-2",
      command: "second"
    })).resolves.toBe("第二条解释".repeat(30));
  });
});
