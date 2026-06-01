import "dotenv/config";
import { readFile } from "node:fs/promises";
import { CodexJsonRpcClient } from "../src/codex/json-rpc-client.js";

async function main(): Promise<void> {
  const url = process.env.CODEX_APP_SERVER_URL || "ws://127.0.0.1:49317";
  const tokenPath = process.env.CODEX_WS_TOKEN_FILE || ".data/codex-ws-token-49317.txt";
  const token = (await readFile(tokenPath, "utf8")).trim();
  const client = new CodexJsonRpcClient({
    url,
    token,
    experimentalApi: true,
    requestTimeoutMs: Number(process.env.DIAG_REQUEST_TIMEOUT_MS || 15_000)
  });

  client.onNotification((notification) => {
    console.error(`[notification] ${notification.method}`);
  });
  client.onServerRequest((request) => {
    console.error(`[server-request] id=${request.id} method=${request.method}`);
    client.reject(request.id, -32603, `diagnostic client cannot handle ${request.method}`);
  });

  console.error(`[diag] connecting ${url}`);
  await client.connect();
  console.error("[diag] connected");

  console.error("[diag] account/read");
  const account = await client.request("account/read", { refreshToken: false });
  console.error(`[diag] account/read result keys=${Object.keys(account as object).join(",")}`);

  console.error("[diag] thread/start");
  const thread = await client.request("thread/start", { cwd: process.cwd() });
  console.error(`[diag] thread/start ok keys=${Object.keys(thread as object).join(",")}`);
  const threadId = (thread as any).thread.id;

  console.error("[diag] turn/start");
  const turn = await client.request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply with exactly: codex diagnostic ok", text_elements: [] }]
  });
  console.error(`[diag] turn/start ok keys=${Object.keys(turn as object).join(",")}`);
  const turnId = (turn as any).turn.id;
  console.error(`[diag] waiting 45s for turn/completed thread=${threadId} turn=${turnId}`);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("diagnostic timeout waiting for turn/completed")), 45_000);
    const unsubscribe = client.onNotification((notification) => {
      const params = notification.params as any;
      const seenThreadId = params?.threadId ?? params?.thread?.id;
      const seenTurnId = params?.turnId ?? params?.turn?.id;
      if (notification.method === "turn/completed" && seenThreadId === threadId && seenTurnId === turnId) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
  console.error("[diag] turn completed");

  client.close();
}

main().catch((error) => {
  console.error("[diag] failed", error);
  process.exit(1);
});
