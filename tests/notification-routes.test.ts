import express from "express";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NotificationCenter } from "../src/notifications/notification-center.js";
import { createRoutes } from "../src/http/routes.js";

describe("notification routes", () => {
  let server: ReturnType<typeof createServer> | undefined;
  let baseUrl = "";
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-notifications-route-"));
    const app = express();
    app.use(express.json());
    const center = new NotificationCenter(dataDir, {
      fetchFn: async () => new Response("ok", { status: 200 })
    });
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
      bridge: {
        listThreads: async () => [],
        startThread: async () => ({}),
        resumeThread: async () => ({}),
        readThread: async () => ({}),
        rollbackThread: async () => ({}),
        compactThread: async () => ({}),
        forkThread: async () => ({}),
        archiveThread: async () => ({}),
        setThreadGoal: async () => ({}),
        getThreadGoal: async () => ({}),
        clearThreadGoal: async () => ({}),
        setThreadName: async () => ({}),
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
      } as any,
      events: { subscribe: () => () => {} } as any,
      projects: { list: async () => [], listArchived: async () => [], add: async () => [], rename: async () => [], pin: async () => [], move: async () => [], delete: async () => [], restore: async () => [] } as any,
      themes: { list: async () => [] } as any,
      threadMetadata: { read: async () => [], write: async () => [] } as any,
      preferences: { read: async () => ({}), update: async () => ({}) } as any,
      status: () => ({}),
      notifications: center as any
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

  test("reads and updates notification settings", async () => {
    const initial = await requestJson(`${baseUrl}/api/notifications`);
    expect(initial.channels).toHaveLength(5);

    const updated = await requestJson(`${baseUrl}/api/notifications`, {
      method: "PUT",
      body: {
        channels: [
          { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" }
        ],
        customChannels: []
      }
    });
    expect(updated.channels[0]).toEqual(expect.objectContaining({ enabled: true, token: "push-token" }));
  });

  test("accepts draft custom channels with empty fields", async () => {
    const updated = await requestJson(`${baseUrl}/api/notifications`, {
      method: "PUT",
      body: {
        customChannels: [
          {
            id: "custom-draft",
            type: "custom",
            name: "",
            enabled: false,
            method: "POST",
            url: "",
            headers: {},
            bodyTemplate: "",
            bodyFormat: "json",
            timeoutMs: 10000
          }
        ]
      }
    });

    expect(updated.customChannels[0]).toEqual(expect.objectContaining({
      id: "custom-draft",
      name: "自定义渠道",
      url: "",
      enabled: false
    }));
  });

  test("lists notification deliveries", async () => {
    const deliveries = await requestJson(`${baseUrl}/api/notifications/deliveries`);
    expect(Array.isArray(deliveries)).toBe(true);
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
  return body.data;
}
