import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { attachBrowserWebSocket } from "../src/http/ws.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

test("sends hello with initial events and tasks", async () => {
  const events = new EventStore();
  events.recordTurnStart("thread-1", "turn-1");
  const server = createServer();
  attachBrowserWebSocket(server, events);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");

  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const first = await nextMessage(ws);
  ws.close();

  expect(first.type).toBe("hello");
  expect(first.events.length).toBeGreaterThan(0);
  expect(first.tasks).toEqual([expect.objectContaining({ threadId: "thread-1", turnId: "turn-1" })]);
});

test("limits hello event replay to recent events", async () => {
  const previousLimit = process.env.CODEX_WEB_WS_REPLAY_EVENT_LIMIT;
  process.env.CODEX_WEB_WS_REPLAY_EVENT_LIMIT = "2";
  try {
    const events = new EventStore();
    for (let index = 0; index < 5; index += 1) {
      events.append({ type: "note", payload: { index } });
    }
    const server = createServer();
    attachBrowserWebSocket(server, events);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing address");

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    const first = await nextMessage(ws);
    ws.close();

    expect(first.type).toBe("hello");
    expect(first.events.map((event: any) => event.seq)).toEqual([4, 5]);
    expect(first.replayLimited).toBe(true);
    expect(first.replayEventLimit).toBe(2);
  } finally {
    if (previousLimit === undefined) {
      delete process.env.CODEX_WEB_WS_REPLAY_EVENT_LIMIT;
    } else {
      process.env.CODEX_WEB_WS_REPLAY_EVENT_LIMIT = previousLimit;
    }
  }
});

test("tracks websocket diagnostics", async () => {
  const events = new EventStore();
  events.append({ type: "note", payload: {} });
  const diagnostics = {
    recordWebSocketOpen: vi.fn(),
    recordWebSocketClose: vi.fn(),
    recordWebSocketSend: vi.fn()
  } as any;
  const server = createServer();
  attachBrowserWebSocket(server, events, undefined, { diagnostics, replayEventLimit: 1 });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");

  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await nextMessage(ws);
  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 20));

  expect(diagnostics.recordWebSocketOpen).toHaveBeenCalledTimes(1);
  expect(diagnostics.recordWebSocketSend).toHaveBeenCalledWith(1);
  expect(diagnostics.recordWebSocketClose).toHaveBeenCalledTimes(1);
});

test("ignores invalid JSON messages", async () => {
  const events = new EventStore();
  const bridge = { approveServerRequest: vi.fn(), rejectServerRequest: vi.fn(), getPendingServerRequests: vi.fn(() => []) } as any;
  const server = createServer();
  attachBrowserWebSocket(server, events, bridge);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");

  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await nextMessage(ws);
  ws.send("{bad json");
  await new Promise((resolve) => setTimeout(resolve, 20));
  ws.close();

  expect(bridge.approveServerRequest).not.toHaveBeenCalled();
  expect(bridge.rejectServerRequest).not.toHaveBeenCalled();
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}
