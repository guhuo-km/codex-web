import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EventStore } from "../src/events/event-store.js";
import { NotificationCenter } from "../src/notifications/notification-center.js";

describe("NotificationCenter", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-notification-center-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("attaches cached token usage to completion notifications", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const center = new NotificationCenter(dataDir, { fetchFn });

    await center.updateSettings({
      channels: [
        { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" },
        { id: "telegram", type: "telegram", enabled: false, botToken: "bot-token", chatId: "chat-id" },
        { id: "serverchan", type: "serverchan", enabled: false },
        { id: "feishu", type: "feishu", enabled: false },
        { id: "qmsg", type: "qmsg", enabled: false }
      ],
      customChannels: []
    });

    await center.handleEvent({
      type: "codex.thread/tokenUsage/updated",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        params: {
          tokenUsage: {
            total: { totalTokens: 42, inputTokens: 10, cachedInputTokens: 0, outputTokens: 32, reasoningOutputTokens: 4 },
            last: { totalTokens: 42, inputTokens: 10, cachedInputTokens: 0, outputTokens: 32, reasoningOutputTokens: 4 },
            modelContextWindow: 128000
          }
        }
      }
    });
    await center.handleEvent({
      type: "turn.completed",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        status: "completed",
        startedAt: "2026-05-31T00:00:00.000Z",
        completedAt: "2026-05-31T00:00:10.000Z",
        durationMs: 10000,
        message: "All done"
      }
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain("pushplus");
    expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toContain("tokens=42");
    expect(await center.listDeliveries()).toHaveLength(1);
  });

  test("fills native duration fields from completion timestamps", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const center = new NotificationCenter(dataDir, { fetchFn });

    await center.updateSettings({
      channels: [],
      customChannels: [
        {
          id: "custom-1",
          type: "custom",
          name: "Webhook",
          enabled: true,
          method: "POST",
          url: "https://example.test/hook",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: "{\"title\":\"{{title}}\",\"message\":\"{{message}}\\nthread={{threadId}}\\nturn={{turnId}}\\nduration={{durationMs}}\\nerror={{errorMessage}}\\ntokens={{tokenUsage.totalTokens}}\\ninput={{tokenUsage.inputTokens}}\\noutput={{tokenUsage.outputTokens}}\",\"source\":\"{{source}}\"}",
          bodyFormat: "json",
          timeoutMs: 3000
        }
      ]
    });

    await center.handleEvent({
      type: "turn.completed",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: {
        status: "completed",
        startedAt: "2026-05-31T00:00:00.000Z",
        completedAt: "2026-05-31T00:00:10.000Z",
        message: "All done"
      }
    });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toContain("duration=10000");
    expect(String(fetchFn.mock.calls[0]?.[1]?.body)).toContain("thread=thread-1");
  });

  test("records a custom webhook delivery result", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("example.test")) return new Response("custom ok", { status: 200 });
      return new Response("ok", { status: 200 });
    });
    const center = new NotificationCenter(dataDir, { fetchFn });

    await center.updateSettings({
      channels: [],
      customChannels: [
        {
          id: "custom-1",
          type: "custom",
          name: "Webhook",
          enabled: true,
          method: "POST",
          url: "https://example.test/hook",
          headers: { "X-Test": "1" },
          bodyTemplate: "{\"title\":\"{{title}}\",\"message\":\"{{message}}\"}",
          bodyFormat: "json",
          timeoutMs: 3000
        }
      ]
    });

    await center.dispatch({
      type: "turn.completed",
      status: "completed",
      title: "Codex task completed",
      message: "All done",
      threadId: "thread-1",
      turnId: "turn-1",
      source: "codex-web"
    });

    const deliveries = await center.listDeliveries();
    expect(deliveries[0]).toEqual(expect.objectContaining({
      channelId: "custom-1",
      channelType: "custom",
      ok: true,
      status: 200
    }));
  });

  test("logs async notification errors from attached event listeners", async () => {
    const center = new NotificationCenter(dataDir);
    vi.spyOn(center, "dispatch").mockRejectedValue(new Error("boom"));
    let listener: Parameters<EventStore["subscribe"]>[0] | undefined;
    center.attach({
      subscribe: (nextListener: Parameters<EventStore["subscribe"]>[0]) => {
        listener = nextListener;
        return () => undefined;
      }
    } as EventStore);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.once("unhandledRejection", unhandled);

    listener?.({
      seq: 1,
      createdAt: new Date().toISOString(),
      type: "turn.completed",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: { status: "completed" }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", unhandled);

    expect(consoleError).toHaveBeenCalledWith("Failed to dispatch completion notification", expect.any(Error));
    expect(unhandled).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
