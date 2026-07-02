import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { EventStore } from "../events/event-store.js";
import { listTaskSummaries } from "../tasks/task-index.js";
import type { BridgeLike } from "./routes.js";
import type { LocalAuth } from "../auth/local-auth.js";
import type { RuntimeDiagnostics } from "../runtime/diagnostics.js";
import type { TerminalManager } from "../terminal/terminal-manager.js";

const DEFAULT_WS_REPLAY_EVENT_LIMIT = 1000;

export interface BrowserWebSocketOptions {
  auth?: LocalAuth;
  diagnostics?: RuntimeDiagnostics;
  replayEventLimit?: number;
  terminals?: TerminalManager;
}

export function attachBrowserWebSocket(
  server: Server,
  events: EventStore,
  bridge?: BridgeLike,
  authOrOptions?: LocalAuth | BrowserWebSocketOptions
): WebSocketServer {
  const options = normalizeOptions(authOrOptions);
  const replayEventLimit = normalizePositiveInteger(options.replayEventLimit ?? Number(process.env.CODEX_WEB_WS_REPLAY_EVENT_LIMIT)) ?? DEFAULT_WS_REPLAY_EVENT_LIMIT;
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: (info, done) => {
      if (!options.auth || !options.auth.isEnabled() || options.auth.isAuthenticated(info.req)) {
        done(true);
        return;
      }
      done(false, 401, "Unauthorized");
    }
  });

  wss.on("connection", (ws, req) => {
    options.diagnostics?.recordWebSocketOpen();
    const terminalOnly = isTerminalOnlySocket(req.url);
    if (terminalOnly) {
      ws.send(JSON.stringify({
        type: "terminal.hello",
        terminalSessions: options.terminals?.list() ?? []
      }));
      ws.on("message", (data) => {
        let message: any;
        try {
          message = JSON.parse(data.toString());
        } catch {
          return;
        }
        options.terminals?.handleMessage(ws, message);
      });
      ws.on("close", () => {
        options.terminals?.handleClose(ws);
        options.diagnostics?.recordWebSocketClose();
      });
      return;
    }
    const replayEvents = events.list({ limit: replayEventLimit });
    ws.send(JSON.stringify({
      type: "hello",
      events: replayEvents,
      replayLimited: events.stats().eventCount > replayEvents.length,
      replayEventLimit,
      tasks: listTaskSummaries(events),
      pendingServerRequests: bridge?.getPendingServerRequests() ?? [],
      terminalSessions: options.terminals?.list() ?? []
    }));
    options.diagnostics?.recordWebSocketSend(replayEvents.length);
    const unsubscribe = events.subscribe((event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "event", event }));
        options.diagnostics?.recordWebSocketSend();
      }
    });
    ws.on("message", (data) => {
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (options.terminals?.handleMessage(ws, message)) return;
      if (!bridge) return;
      if (message.type === "approval.approve") {
        bridge.approveServerRequest(String(message.requestId), message.result ?? {});
      }
      if (message.type === "approval.reject") {
        bridge.rejectServerRequest(String(message.requestId), String(message.message ?? "Rejected by user"));
      }
    });
    ws.on("close", () => {
      unsubscribe();
      options.terminals?.handleClose(ws);
      options.diagnostics?.recordWebSocketClose();
    });
  });

  return wss;
}

function isTerminalOnlySocket(url: string | undefined): boolean {
  try {
    return new URL(url ?? "/ws", "http://localhost").searchParams.get("scope") === "terminal";
  } catch {
    return false;
  }
}

function normalizeOptions(input?: LocalAuth | BrowserWebSocketOptions): BrowserWebSocketOptions {
  if (!input) return {};
  if ("isAuthenticated" in input) return { auth: input };
  return input;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}
