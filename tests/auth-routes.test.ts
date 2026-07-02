import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { createAppServer } from "../src/server.js";
import { EventStore } from "../src/events/event-store.js";
import { JsonlStore } from "../src/persistence/jsonl-store.js";
import { ProjectStore } from "../src/projects/project-store.js";
import { ThemeStore } from "../src/themes/theme-store.js";
import { ThreadMetadataStore } from "../src/threads/thread-metadata-store.js";
import { UserPreferencesStore } from "../src/preferences/user-preferences-store.js";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];
const servers: Array<{ close: () => void }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local auth", () => {
  test("requires login before api access and allows authenticated requests after login", async () => {
    const { baseUrl, login } = await startServer();
    await expectJson(`${baseUrl}/api/auth/status`, { ok: true, data: { enabled: true, authenticated: false } });

    const denied = await fetch(`${baseUrl}/api/projects`);
    expect(denied.status).toBe(401);

    const appShell = await fetch(`${baseUrl}/`);
    expect(appShell.status).toBe(200);
    expect(appShell.headers.get("content-type")).toContain("text/html");

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "wrong" })
    });
    expect(badLogin.status).toBe(401);

    const authCookie = await login("root");
    const granted = await fetch(`${baseUrl}/api/projects`, {
      headers: { cookie: authCookie }
    });
    expect(granted.status).toBe(200);

    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: authCookie }
    });
    expect(logout.status).toBe(200);
  });

  test("allows editing auth settings and persists them to evn", async () => {
    const { baseUrl, login, dataDir } = await startServer();
    const authCookie = await login("root");

    const response = await fetch(`${baseUrl}/api/auth/settings`, {
      method: "PUT",
      headers: {
        cookie: authCookie,
        "content-type": "application/json"
      },
      body: JSON.stringify({ enabled: false, password: "new-root" })
    });
    expect(response.status).toBe(200);
    await expectJson(`${baseUrl}/api/auth/status`, { ok: true, data: { enabled: false, authenticated: true } });

    const envFile = await readFile(join(dataDir, ".evn"), "utf8");
    expect(envFile).toContain("CODEX_WEB_AUTH_ENABLED=false");
    expect(envFile).toContain("CODEX_WEB_PASSWORD=new-root");
  });

  test("requires login before websocket access", async () => {
    const { port, login } = await startServer();
    await expect(readWsHello(port)).rejects.toThrow("401");

    const authCookie = await login("root");
    await expect(readWsHello(port, authCookie)).resolves.toEqual(expect.objectContaining({ type: "hello" }));
  });
});

async function startServer(): Promise<{ baseUrl: string; port: number; dataDir: string; login: (password: string) => Promise<string> }> {
  const dataDir = await mkdtemp(join(tmpdir(), "codex-web-auth-test-"));
  tempDirs.push(dataDir);
  const events = new EventStore(new JsonlStore(dataDir));
  const bridge = {
    listThreads: async () => ({ data: [] }),
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
    startTurn: async () => ({}),
    startTurnItems: async () => ({}),
    interruptTurn: async () => ({}),
    steerTurn: async () => ({}),
    listSkills: async () => ({ data: [] }),
    listPlugins: async () => ({ data: [] }),
    listMcpServers: async () => ({ data: [] }),
    listModels: async () => ({ data: [] , nextCursor: null }),
    readConfig: async () => ({}),
    writeSkillConfig: async () => ({}),
    writeConfigBatch: async () => ({}),
    getPendingServerRequests: () => [],
    approveServerRequest: () => undefined,
    rejectServerRequest: () => undefined
  };
  const { app, attachWebSocket } = createAppServer({
    config: loadConfig({
      NODE_ENV: "test",
      CODEX_WEB_DATA_DIR: dataDir,
      CODEX_WEB_CONFIG_DIR: dataDir,
      CODEX_WEB_PROJECT_ROOT: dataDir,
      CODEX_WEB_AUTH_ENABLED: "true",
      CODEX_WEB_PASSWORD: "root"
    }),
    bridge,
    events,
    projects: new ProjectStore(dataDir),
    themes: new ThemeStore(dataDir),
    threadMetadata: new ThreadMetadataStore(dataDir),
    preferences: new UserPreferencesStore(dataDir),
    status: () => ({ connected: true })
  });
  const server = createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    dataDir,
    login: async (password: string) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password })
      });
      expect(response.status).toBe(200);
      const cookies = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
      const cookie = cookies[0] ?? response.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("codex_web_session=");
      return cookie;
    }
  };
}

function readWsHello(port: number, cookie?: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, cookie ? { headers: { cookie } } : undefined);
    ws.once("unexpected-response", (_request, response) => {
      reject(new Error(String(response.statusCode)));
    });
    ws.once("message", (data) => {
      ws.close();
      resolve(JSON.parse(data.toString()));
    });
    ws.once("error", reject);
  });
}

async function expectJson(url: string, expected: unknown): Promise<void> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expected);
}
