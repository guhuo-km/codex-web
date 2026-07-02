import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TitleGenerationService } from "../src/title-generation/title-generation-service.js";
import { TitleGenerationStore } from "../src/title-generation/title-generation-store.js";

describe("TitleGenerationService", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-title-generation-service-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("posts a chat completions request and extracts a cleaned title", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: "\"修复标题生成\"" } }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const store = new TitleGenerationStore(dataDir);
    await store.write({
      enabled: true,
      apiBaseUrl: "https://example.test/v1/",
      apiKey: "secret-key",
      model: "title-model",
      timeoutMs: 5000
    });
    const service = new TitleGenerationService(store, { fetchFn });

    const title = await service.generateTitle({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              { type: "userMessage", text: "我想把默认折叠行为改掉" },
              { type: "agentMessage", text: "可以，先查逻辑。" }
            ]
          }
        ]
      }
    });

    expect(title).toBe("修复标题生成");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["Authorization"]).toBe("Bearer secret-key");
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      model: "title-model"
    }));
  });

  test("explains command behavior without asking for intent or risk analysis", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: "读取 package.json 的完整文本内容。" } }
      ]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const store = new TitleGenerationStore(dataDir);
    await store.write({
      enabled: true,
      apiBaseUrl: "https://example.test/v1/",
      apiKey: "secret-key",
      model: "assist-model",
      timeoutMs: 5000
    });
    const service = new TitleGenerationService(store, { fetchFn });

    const explanation = await service.explainCommand({ command: "Get-Content -Raw package.json" });

    expect(explanation).toBe("读取 package.json 的完整文本内容。");
    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("assist-model");
    expect(body.messages[0].content).toContain("只解释真正执行的核心动作");
    expect(body.messages[0].content).toContain("忽略外层 shell 启动器");
    expect(body.messages[0].content).toContain("别废话");
    expect(body.messages[0].content).toContain("不要推测 Agent 的意图");
    expect(body.messages[0].content).toContain("不要做安全或风险结论");
    expect(body.messages[1].content).toContain("Get-Content -Raw package.json");
  });
});
