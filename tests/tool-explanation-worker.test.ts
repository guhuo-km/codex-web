import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { TitleGenerationService } from "../src/title-generation/title-generation-service.js";
import { TitleGenerationStore } from "../src/title-generation/title-generation-store.js";
import { ToolExplanationService } from "../src/tool-explanations/tool-explanation-service.js";
import { ToolExplanationStore } from "../src/tool-explanations/tool-explanation-store.js";
import { attachToolExplanationWorker } from "../src/tool-explanations/tool-explanation-worker.js";

describe("tool explanation worker", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-tool-explanation-worker-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("explains command execution events on the backend without a frontend request", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "读取 package.json 的完整文本。" } }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const titleStore = new TitleGenerationStore(dataDir);
    await titleStore.write({
      enabled: true,
      apiBaseUrl: "https://example.test/v1/",
      apiKey: "secret-key",
      model: "assist-model",
      timeoutMs: 5000
    });
    const explanations = new ToolExplanationStore(dataDir);
    const service = new ToolExplanationService(explanations, new TitleGenerationService(titleStore, { fetchFn }));
    const events = new EventStore();
    attachToolExplanationWorker(events, service);

    events.append({
      type: "codex.item/completed",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        params: {
          item: {
            type: "commandExecution",
            id: "tool-1",
            command: "Get-Content -Raw package.json"
          }
        }
      }
    });

    await waitFor(async () => {
      await expect(explanations.get({
        threadId: "thread-1",
        turnId: "turn-1",
        toolCallId: "tool-1",
        command: "Get-Content -Raw package.json"
      })).resolves.toBe("读取 package.json 的完整文本。");
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

async function waitFor(assertion: () => Promise<void>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}
