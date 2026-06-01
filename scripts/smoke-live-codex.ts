import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { CodexAppServerManager } from "../src/codex/app-server-manager.js";
import { CodexBridge } from "../src/codex/codex-bridge.js";
import { CodexJsonRpcClient } from "../src/codex/json-rpc-client.js";
import { EventStore } from "../src/events/event-store.js";

export interface RunSmokeDeps {
  manager: Pick<CodexAppServerManager, "ensureRunning" | "shutdown">;
  clientFactory: (endpoint: { url: string; token?: string }) => Pick<CodexJsonRpcClient, "connect" | "close">;
  bridgeFactory: (client: any, events: EventStore) => Pick<CodexBridge, "startThread" | "startTurn">;
  waitForTurnCompletion: typeof waitForTurnCompletion;
  cwd: string;
}

export async function waitForTurnCompletion(
  events: EventStore,
  threadId: string,
  turnId: string,
  timeoutMs: number
): Promise<void> {
  if (events.list({ threadId }).some((event) => event.turnId === turnId && event.type === "codex.turn/completed")) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for turn completion"));
    }, timeoutMs);
    const unsubscribe = events.subscribe((event) => {
      if (event.threadId === threadId && event.turnId === turnId && event.type === "codex.turn/completed") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

export async function runSmoke(deps: RunSmokeDeps): Promise<unknown> {
  const events = new EventStore();
  let client: Pick<CodexJsonRpcClient, "connect" | "close"> | undefined;

  try {
    const endpoint = await deps.manager.ensureRunning();
    client = deps.clientFactory(endpoint);
    console.error("[smoke] connecting to codex app-server");
    await client.connect();
    const bridge = deps.bridgeFactory(client, events);

    console.error("[smoke] starting thread");
    const threadResponse = await bridge.startThread({ cwd: deps.cwd }) as any;
    const threadId = threadResponse.thread.id;
    console.error(`[smoke] starting turn in ${threadId}`);
    const turnResponse = await bridge.startTurn(threadId, "Reply with exactly: codex web bridge smoke ok") as any;
    const turnId = turnResponse.turn.id;
    console.error(`[smoke] waiting for turn ${turnId}`);
    await deps.waitForTurnCompletion(events, threadId, turnId, 120_000);

    return {
      ok: true,
      threadId,
      turnId,
      eventTypes: events.list({ threadId }).map((event) => event.type)
    };
  } finally {
    client?.close();
    await deps.manager.shutdown();
  }
}

async function main(): Promise<void> {
  const config = loadConfig({
    ...process.env,
    DATA_DIR: process.env.SMOKE_DATA_DIR || process.env.DATA_DIR || ".data-smoke",
    CODEX_APP_SERVER_PORT: process.env.CODEX_APP_SERVER_PORT || "49318"
  });
  const manager = new CodexAppServerManager(config);
  const result = await runSmoke({
    manager,
    clientFactory: (endpoint) => new CodexJsonRpcClient({
      url: endpoint.url,
      token: endpoint.token,
      experimentalApi: config.enableExperimentalCodexApi,
      requestTimeoutMs: Number(process.env.SMOKE_REQUEST_TIMEOUT_MS || 30_000)
    }),
    bridgeFactory: (client, events) => new CodexBridge(client, events),
    waitForTurnCompletion,
    cwd: process.cwd()
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1]?.endsWith("smoke-live-codex.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
