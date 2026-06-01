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

loadDotenv({ path: ".env" });
loadDotenv({ path: ".evn", override: true });

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const config = loadConfig();
const events = new EventStore(new JsonlStore(config.dataDir));
const projects = new ProjectStore(config.dataDir);
const themes = new ThemeStore(config.dataDir);
const threadMetadata = new ThreadMetadataStore(config.dataDir);
const preferences = new UserPreferencesStore(config.dataDir);
const manager = new CodexAppServerManager(config);

let client: CodexJsonRpcClient | undefined;

async function main(): Promise<void> {
  await events.load();
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
    status: () => ({
      connected: true,
      codexAppServerUrl: endpoint.url,
      runningTurns: events.getRunningTurns()
    })
  });

  const server = createServer(app);
  attachWebSocket(server);

  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  logger.info({ host: config.host, port: config.port }, "codex-web listening");

  const shutdown = async () => {
    logger.info("Shutting down codex-web");
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
    "Failed to start codex-web"
  );
  process.exit(1);
});
