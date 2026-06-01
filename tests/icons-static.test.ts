import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chdir, cwd } from "node:process";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAppServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { EventStore } from "../src/events/event-store.js";
import { ProjectStore } from "../src/projects/project-store.js";
import { ThemeStore } from "../src/themes/theme-store.js";
import { ThreadMetadataStore } from "../src/threads/thread-metadata-store.js";
import { UserPreferencesStore } from "../src/preferences/user-preferences-store.js";

const originalCwd = cwd();
const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  chdir(originalCwd);
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("static icons", () => {
  test("serves icon assets from /icons", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-web-icons-"));
    tempDirs.push(root);
    await mkdir(join(root, "icons"), { recursive: true });
    await writeFile(join(root, "icons", "tool-call.svg"), "<svg></svg>", "utf8");
    chdir(root);

    const dataDir = join(root, ".data");
    const { app } = createAppServer({
      config: loadConfig({ CODEX_WEB_DATA_DIR: dataDir, NODE_ENV: "test" }),
      bridge: {
        listThreads: vi.fn(),
        startThread: vi.fn(),
        resumeThread: vi.fn(),
        readThread: vi.fn(),
        rollbackThread: vi.fn(),
        compactThread: vi.fn(),
        forkThread: vi.fn(),
        archiveThread: vi.fn(),
        startTurn: vi.fn(),
        startTurnItems: vi.fn(),
        interruptTurn: vi.fn(),
        steerTurn: vi.fn(),
        listSkills: vi.fn(),
        listPlugins: vi.fn(),
        listMcpServers: vi.fn(),
        listModels: vi.fn(),
        readConfig: vi.fn(),
        writeSkillConfig: vi.fn(),
        writeConfigBatch: vi.fn(),
        approveServerRequest: vi.fn(),
        rejectServerRequest: vi.fn(),
        getPendingServerRequests: vi.fn(() => [])
      } as any,
      events: new EventStore(),
      projects: new ProjectStore(dataDir),
      themes: new ThemeStore(dataDir),
      threadMetadata: new ThreadMetadataStore(dataDir),
      preferences: new UserPreferencesStore(dataDir),
      status: () => ({ connected: true })
    });
    const server = createServer(app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");

    const response = await fetch(`http://127.0.0.1:${address.port}/icons/tool-call.svg`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<svg></svg>");
  });
});
