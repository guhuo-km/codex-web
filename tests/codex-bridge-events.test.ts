import { describe, expect, test, vi } from "vitest";
import { CodexBridge } from "../src/codex/codex-bridge.js";
import { EventStore } from "../src/events/event-store.js";

describe("CodexBridge event attribution", () => {
  test("records model request status after a turn start returns a turn id", async () => {
    const client = fakeClient();
    client.request.mockResolvedValueOnce({ turn: { id: "turn-1" } });
    const store = new EventStore();
    const bridge = new CodexBridge(client as any, store);

    await bridge.startTurn("thread-1", "hello");

    expect(store.list({ threadId: "thread-1" })).toEqual([
      expect.objectContaining({
        type: "codex.agent/status",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: expect.objectContaining({
          kind: "status",
          phase: "model_request",
          message: "正在请求模型"
        })
      })
    ]);
  });

  test("attaches thread-scoped notifications to the running turn when app-server omits turn id", () => {
    const client = fakeClient();
    const store = new EventStore();
    new CodexBridge(client as any, store);

    client.emitNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    client.emitNotification({ method: "warning", params: { threadId: "thread-1", message: "Network degraded" } });

    expect(store.list({ threadId: "thread-1" }).at(-1)).toEqual(expect.objectContaining({
      type: "codex.warning",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        method: "warning",
        params: { threadId: "thread-1", message: "Network degraded" }
      }
    }));
  });

  test("keeps server requests attached to the originating turn", () => {
    const client = fakeClient();
    const store = new EventStore();
    new CodexBridge(client as any, store);

    client.emitServerRequest({
      method: "item/commandExecution/requestApproval",
      id: 42,
      params: { threadId: "thread-1", turnId: "turn-1", command: "npm test" }
    });

    expect(store.list({ threadId: "thread-1" })).toEqual([
      expect.objectContaining({
        type: "codex.request.item/commandExecution/requestApproval",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: expect.objectContaining({
          id: 42,
          method: "item/commandExecution/requestApproval"
        })
      })
    ]);
  });

  test("keeps resolved server requests attached to the inferred running turn", () => {
    const client = fakeClient();
    const store = new EventStore();
    const bridge = new CodexBridge(client as any, store);

    client.emitNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    client.emitServerRequest({
      method: "item/commandExecution/requestApproval",
      id: 42,
      params: { threadId: "thread-1", command: "npm test" }
    });
    bridge.approveServerRequest(42, { decision: "accept" });

    expect(store.list({ threadId: "thread-1" }).at(-1)).toEqual(expect.objectContaining({
      type: "codex.serverRequest/resolved",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: expect.objectContaining({
        requestId: 42,
        method: "item/commandExecution/requestApproval",
        decision: "accept"
      })
    }));
  });
});

function fakeClient() {
  let notificationListener: ((notification: any) => void) | undefined;
  let serverRequestListener: ((request: any) => void) | undefined;
  return {
    request: vi.fn(async () => ({})),
    respond: vi.fn(),
    reject: vi.fn(),
    onNotification: vi.fn((listener: (notification: any) => void) => {
      notificationListener = listener;
      return () => {};
    }),
    onServerRequest: vi.fn((listener: (request: any) => void) => {
      serverRequestListener = listener;
      return () => {};
    }),
    emitNotification(notification: any) {
      notificationListener?.(notification);
    },
    emitServerRequest(request: any) {
      serverRequestListener?.(request);
    }
  };
}
