import type { Server } from "node:http";
import { WebSocketServer } from "ws";
import type { EventStore } from "../events/event-store.js";
import { listTaskSummaries } from "../tasks/task-index.js";
import type { BridgeLike } from "./routes.js";
import type { LocalAuth } from "../auth/local-auth.js";

export function attachBrowserWebSocket(server: Server, events: EventStore, bridge?: BridgeLike, auth?: LocalAuth): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: (info, done) => {
      if (!auth || !auth.isEnabled() || auth.isAuthenticated(info.req)) {
        done(true);
        return;
      }
      done(false, 401, "Unauthorized");
    }
  });

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({
      type: "hello",
      events: events.list(),
      tasks: listTaskSummaries(events),
      pendingServerRequests: bridge?.getPendingServerRequests() ?? []
    }));
    const unsubscribe = events.subscribe((event) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "event", event }));
      }
    });
    ws.on("message", (data) => {
      if (!bridge) return;
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.type === "approval.approve") {
        bridge.approveServerRequest(String(message.requestId), message.result ?? {});
      }
      if (message.type === "approval.reject") {
        bridge.rejectServerRequest(String(message.requestId), String(message.message ?? "Rejected by user"));
      }
    });
    ws.on("close", unsubscribe);
  });

  return wss;
}
