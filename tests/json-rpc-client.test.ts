import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { CodexJsonRpcClient } from "../src/codex/json-rpc-client.js";

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("CodexJsonRpcClient", () => {
  test("performs initialize handshake and sends initialized notification", async () => {
    const seen: unknown[] = [];
    const { url } = await startFakeServer((message, ws) => {
      seen.push(message);
      if (message.method === "initialize") {
        ws.send(JSON.stringify({ id: message.id, result: { userAgent: "codex-test/1.0", codexHome: "D:\\codex", platformFamily: "windows", platformOs: "windows" } }));
      }
    });

    const client = new CodexJsonRpcClient({ url, experimentalApi: true });
    await client.connect();
    await waitFor(() => seen.length === 2);
    client.close();

    expect(seen).toEqual([
      expect.objectContaining({ method: "initialize", id: "initialize" }),
      expect.objectContaining({ method: "initialized" })
    ]);
  });

  test("resolves responses and emits notifications and server requests", async () => {
    const { url } = await startFakeServer((message, ws) => {
      if (message.method === "initialize") {
        ws.send(JSON.stringify({ id: message.id, result: { userAgent: "codex-test/1.0", codexHome: "D:\\codex", platformFamily: "windows", platformOs: "windows" } }));
      }
      if (message.method === "thread/list") {
        ws.send(JSON.stringify({ method: "thread/status/changed", params: { threadId: "t1", status: "running" } }));
        ws.send(JSON.stringify({ method: "item/tool/requestUserInput", id: 42, params: { threadId: "t1" } }));
        ws.send(JSON.stringify({ id: message.id, result: { data: [], nextCursor: null, backwardsCursor: null } }));
      }
    });
    const notifications: string[] = [];
    const requests: number[] = [];
    const client = new CodexJsonRpcClient({ url, experimentalApi: true });
    client.onNotification((notification) => notifications.push(notification.method));
    client.onServerRequest((request) => requests.push(Number(request.id)));

    await client.connect();
    const result = await client.request("thread/list", { limit: 10 });
    client.close();

    expect(result).toEqual({ data: [], nextCursor: null, backwardsCursor: null });
    expect(notifications).toEqual(["thread/status/changed"]);
    expect(requests).toEqual([42]);
  });

  test("sends bearer token header", async () => {
    let authorization: string | undefined;
    const { url } = await startFakeServer(
      (message, ws) => {
        if (message.method === "initialize") {
          ws.send(JSON.stringify({ id: message.id, result: { userAgent: "codex-test/1.0", codexHome: "D:\\codex", platformFamily: "windows", platformOs: "windows" } }));
        }
      },
      (header) => {
        authorization = header;
      }
    );

    const client = new CodexJsonRpcClient({ url, token: "abc123", experimentalApi: true });
    await client.connect();
    client.close();

    expect(authorization).toBe("Bearer abc123");
  });
});

async function startFakeServer(
  onMessage: (message: any, ws: import("ws").WebSocket) => void,
  onAuth?: (authorization: string | undefined) => void
): Promise<{ url: string }> {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  wss.on("connection", (ws, request) => {
    onAuth?.(request.headers.authorization);
    ws.on("message", (data) => onMessage(JSON.parse(data.toString()), ws));
  });
  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  servers.push({
    close: () =>
      new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      })
  });
  return { url: `ws://127.0.0.1:${port}` };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
