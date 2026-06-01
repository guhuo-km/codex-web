import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoutes } from "../src/http/routes.js";
import { TitleGenerationService } from "../src/title-generation/title-generation-service.js";
import { TitleGenerationStore } from "../src/title-generation/title-generation-store.js";

describe("title generation routes", () => {
  let server: ReturnType<typeof createServer> | undefined;
  let baseUrl = "";
  let dataDir = "";
  let bridge: any;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-title-generation-routes-"));
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "AI 标题生成设置" } }]
    }), {
      status: 200,
      headers: { "content-type": "application/json" }
    }));
    const titleGeneration = new TitleGenerationService(new TitleGenerationStore(dataDir), { fetchFn });
    bridge = {
      listThreads: async () => [],
      startThread: async () => ({}),
      resumeThread: async () => ({}),
      readThread: vi.fn(async () => ({
        thread: {
          id: "thread-1",
          turns: [
            {
              id: "turn-1",
              items: [
                { type: "userMessage", text: "我想配置自定义 OpenAI 标题生成" },
                { type: "agentMessage", text: "可以新增设置页和请求逻辑。" }
              ]
            }
          ]
        }
      })),
      rollbackThread: async () => ({}),
      compactThread: async () => ({}),
      forkThread: async () => ({}),
      archiveThread: async () => ({}),
      setThreadGoal: async () => ({}),
      getThreadGoal: async () => ({}),
      clearThreadGoal: async () => ({}),
      setThreadName: vi.fn(async () => ({})),
      getConversationSummary: async () => ({}),
      startTurn: async () => ({}),
      startTurnItems: async () => ({}),
      interruptTurn: async () => ({}),
      steerTurn: async () => ({}),
      listSkills: async () => ({}),
      listPlugins: async () => ({}),
      listMcpServers: async () => ({}),
      listModels: async () => ({}),
      readConfig: async () => ({}),
      writeSkillConfig: async () => ({}),
      writeConfigBatch: async () => ({}),
      getPendingServerRequests: () => [],
      approveServerRequest: () => {},
      rejectServerRequest: () => {}
    };
    const app = express();
    app.use(express.json());
    app.use(createRoutes({
      config: {
        host: "127.0.0.1",
        port: 0,
        frontendPort: 0,
        codexBin: "codex",
        codexAppServerPort: 0,
        dataDir,
        projectRoot: process.cwd(),
        password: "root",
        enableExperimentalCodexApi: true
      } as any,
      bridge,
      events: { list: () => [], subscribe: () => () => {}, interruptStaleRunningTurns: () => {} } as any,
      projects: { list: async () => [], listArchived: async () => [], add: async () => [], rename: async () => [], pin: async () => [], move: async () => [], delete: async () => [], restore: async () => [] } as any,
      themes: { list: async () => [] } as any,
      threadMetadata: { list: async () => [], read: async () => undefined, update: async () => undefined } as any,
      preferences: { read: async () => ({}), update: async () => ({}) } as any,
      notifications: { readSettings: async () => ({}), updateSettings: async () => ({}), listDeliveries: async () => [], dispatch: async () => [] } as any,
      titleGeneration,
      status: () => ({})
    } as any));
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (typeof address === "object" && address && "port" in address) {
      baseUrl = `http://127.0.0.1:${address.port}`;
    }
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
    await rm(dataDir, { recursive: true, force: true });
  });

  test("updates settings without exposing API key and uses them to rename a thread", async () => {
    await requestJson(`${baseUrl}/api/title-generation`, {
      method: "PUT",
      body: {
        enabled: true,
        apiBaseUrl: "https://example.test/v1",
        apiKey: "secret-key",
        model: "title-model",
        timeoutMs: 5000
      }
    });

    const settings = await requestJson(`${baseUrl}/api/title-generation`);
    expect(settings).toEqual({
      enabled: true,
      apiBaseUrl: "https://example.test/v1",
      apiKeyConfigured: true,
      model: "title-model",
      timeoutMs: 5000
    });
    expect(JSON.stringify(settings)).not.toContain("secret-key");

    const result = await requestJson(`${baseUrl}/api/threads/thread-1/title/generate`, { method: "POST", body: {} });
    expect(result).toEqual({ title: "AI 标题生成设置" });
    expect(bridge.readThread).toHaveBeenCalledWith("thread-1", true);
    expect(bridge.setThreadName).toHaveBeenCalledWith("thread-1", "AI 标题生成设置");
  });
});

async function requestJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    },
    body: init.body ? JSON.stringify(init.body) : undefined
  });
  const body = await response.json();
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  return body.data;
}
