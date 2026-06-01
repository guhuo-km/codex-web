import { createServer } from "node:http";
import { config as loadDotenv } from "dotenv";
import pino from "pino";
import { loadConfig } from "./config.js";
import { CodexAppServerManager } from "./codex/app-server-manager.js";
import { CodexJsonRpcClient } from "./codex/json-rpc-client.js";
import { CodexBridge } from "./codex/codex-bridge.js";
import { EventStore } from "./events/event-store.js";
import { JsonlStore } from "./persistence/jsonl-store.js";
import { ProjectStore } from "./projects/project-store.js";
import { createAppServer } from "./server.js";
import { ThemeStore } from "./themes/theme-store.js";
import { ThreadMetadataStore } from "./threads/thread-metadata-store.js";
import { UserPreferencesStore } from "./preferences/user-preferences-store.js";
import { RuntimeDiagnostics } from "./runtime/diagnostics.js";

loadDotenv({ path: ".env" });
loadDotenv({ path: ".evn", override: true });

const EVENT_RETENTION_MAX_EVENTS = readPositiveInteger("CODEX_WEB_EVENT_RETENTION_MAX_EVENTS", 50_000);
const EVENT_RETENTION_MAX_BYTES = readPositiveInteger("CODEX_WEB_EVENT_RETENTION_MAX_BYTES", 25 * 1024 * 1024);
const EVENT_COMPACTION_INTERVAL_MS = readPositiveInteger("CODEX_WEB_EVENT_COMPACTION_INTERVAL_MS", 30 * 60 * 1000);
const EVENT_ARCHIVE_MAX_FILES = readPositiveInteger("CODEX_WEB_EVENT_ARCHIVE_MAX_FILES", 3);
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const config = loadConfig();
const events = new EventStore(new JsonlStore(config.dataDir, { maxArchives: EVENT_ARCHIVE_MAX_FILES }), {
  maxEvents: EVENT_RETENTION_MAX_EVENTS,
  maxEventBytes: EVENT_RETENTION_MAX_BYTES
});
const projects = new ProjectStore(config.dataDir);
const themes = new ThemeStore(config.dataDir);
const threadMetadata = new ThreadMetadataStore(config.dataDir);
const preferences = new UserPreferencesStore(config.dataDir);
const manager = new CodexAppServerManager(config);
const diagnostics = new RuntimeDiagnostics(events);

let client: CodexJsonRpcClient | undefined;
let maintenanceTimer: NodeJS.Timeout | undefined;

async function main(): Promise<void> {
  await events.load();
  await compactEvents("startup");
  maintenanceTimer = setInterval(() => void compactEvents("interval"), EVENT_COMPACTION_INTERVAL_MS);
  const endpoint = await manager.ensureRunning();
  client = new CodexJsonRpcClient({
    url: endpoint.url,
    token: endpoint.token,
    experimentalApi: config.enableExperimentalCodexApi
  });
  await client.connect();

  const bridge = new CodexBridge(client, events);
  const { app, attachWebSocket } = createAppServer({
    config,
    bridge,
    events,
    projects,
    themes,
    threadMetadata,
    preferences,
    diagnostics,
    status: () => ({
      connected: true,
      codexAppServerUrl: endpoint.url,
      runningTurns: events.getRunningTurns()
    })
  });

  const server = createServer(app);
  attachWebSocket(server);

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info({ host: config.host, port: config.port }, "Codex Web Bridge listening");

  const shutdown = async () => {
    logger.info("Shutting down Codex Web Bridge");
    if (maintenanceTimer) clearInterval(maintenanceTimer);
    client?.close();
    await manager.shutdown();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  logger.error(
    {
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error
    },
    "Failed to start Codex Web Bridge"
  );
  process.exit(1);
});

async function compactEvents(reason: string): Promise<void> {
  try {
    await events.compactPersistence();
    logger.info({ reason, events: events.stats() }, "Compacted bridge events");
  } catch (error) {
    logger.warn(
      {
        reason,
        error: error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error
      },
      "Failed to compact bridge events"
    );
  }
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
