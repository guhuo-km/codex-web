import express from "express";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CodexBridge } from "../src/codex/codex-bridge.js";
import { EventStore } from "../src/events/event-store.js";
import { createRoutes } from "../src/http/routes.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("steer protocol", () => {
  test("forwards client user message ids to app-server steer", async () => {
    const client = fakeRpcClient();
    const bridge = new CodexBridge(client as any, new EventStore());

    await bridge.steerTurn("thread-1", "追加引导", "turn-1", "steer-client-1");

    expect(client.request).toHaveBeenCalledWith("turn/steer", {
      threadId: "thread-1",
      clientUserMessageId: "steer-client-1",
      input: [{ type: "text", text: "追加引导", text_elements: [] }],
      expectedTurnId: "turn-1"
    });
  });

  test("keeps client user message ids across the HTTP steer boundary", async () => {
    const bridge = minimalBridge();
    const { baseUrl } = await startRoutes(bridge);

    const response = await fetch(`${baseUrl}/api/threads/thread-1/steer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "追加引导", turnId: "turn-1", clientUserMessageId: "steer-client-1" })
    });

    expect(response.status).toBe(200);
    expect(bridge.steerTurn).toHaveBeenCalledWith("thread-1", "追加引导", "turn-1", "steer-client-1");
  });

  test("does not insert steer messages into the assistant stream before app-server confirms them", () => {
    const source = readFileSync("web/src/App.tsx", "utf8");
    const queueSteerBody = source.slice(
      source.indexOf("async function queueSteerMessage"),
      source.indexOf("function confirmUserMessageItem")
    );

    expect(queueSteerBody).not.toContain("upsertAssistantSteer");
  });
});

function fakeRpcClient() {
  return {
    request: vi.fn(async () => ({ turnId: "turn-1" })),
    respond: vi.fn(),
    reject: vi.fn(),
    onNotification: vi.fn(),
    onServerRequest: vi.fn()
  };
}

function minimalBridge() {
  return {
    listThreads: vi.fn(async () => ({ data: [] })),
    startThread: vi.fn(async () => ({})),
    resumeThread: vi.fn(async () => ({})),
    readThread: vi.fn(async () => ({})),
    rollbackThread: vi.fn(async () => ({})),
    compactThread: vi.fn(async () => ({})),
    forkThread: vi.fn(async () => ({})),
    archiveThread: vi.fn(async () => ({})),
    setThreadGoal: vi.fn(async () => ({})),
    getThreadGoal: vi.fn(async () => ({})),
    clearThreadGoal: vi.fn(async () => ({})),
    setThreadName: vi.fn(async () => ({})),
    startTurn: vi.fn(async () => ({})),
    startTurnItems: vi.fn(async () => ({})),
    interruptTurn: vi.fn(async () => ({})),
    steerTurn: vi.fn(async () => ({ turnId: "turn-1" })),
    listSkills: vi.fn(async () => ({ data: [] })),
    listPlugins: vi.fn(async () => ({ data: [] })),
    listMcpServers: vi.fn(async () => ({ data: [] })),
    listModels: vi.fn(async () => ({ data: [] })),
    readConfig: vi.fn(async () => ({})),
    writeSkillConfig: vi.fn(async () => ({})),
    writeConfigBatch: vi.fn(async () => ({})),
    getPendingServerRequests: vi.fn(() => []),
    approveServerRequest: vi.fn(),
    rejectServerRequest: vi.fn()
  };
}

async function startRoutes(bridge: ReturnType<typeof minimalBridge>): Promise<{ baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use(createRoutes({
    config: {
      host: "127.0.0.1",
      port: 0,
      dataDir: ".data-test",
      codexHome: undefined,
      auth: { enabled: false, password: undefined },
      appServer: { mode: "managed", command: "codex", args: [], url: undefined, token: undefined }
    },
    bridge,
    events: new EventStore(),
    projects: {} as any,
    themes: {} as any,
    threadMetadata: {} as any,
    preferences: {} as any,
    notifications: {} as any,
    titleGeneration: {} as any,
    status: () => ({ connected: true })
  }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}` };
}
