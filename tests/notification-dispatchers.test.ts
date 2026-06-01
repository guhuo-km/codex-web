import { describe, expect, test, vi } from "vitest";
import { dispatchNotifications } from "../src/notifications/dispatchers.js";
import type { CompletionNotification } from "../src/notifications/notification-types.js";
import type { NotificationSettings } from "../src/notifications/notification-store.js";

function makeNotification(): CompletionNotification {
  return {
    type: "turn.completed",
    status: "completed",
    title: "Codex task completed",
    message: "Finished successfully",
    threadId: "thread-1",
    turnId: "turn-1",
    source: "codex-web",
    startedAt: 10,
    completedAt: 20,
    durationMs: 10,
    tokenUsage: { totalTokens: 12, inputTokens: 5, outputTokens: 7 }
  };
}

describe("dispatchNotifications", () => {
  test("sends enabled built-in channels and custom channels", async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes("pushplus")) return new Response("ok", { status: 200 });
      if (String(url).includes("example.test")) return new Response("custom ok", { status: 200 });
      return new Response("ok", { status: 200 });
    });
    const settings: NotificationSettings = {
      channels: [
        { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" },
        { id: "telegram", type: "telegram", enabled: false, botToken: "bot-token", chatId: "chat-id" },
        { id: "serverchan", type: "serverchan", enabled: false },
        { id: "feishu", type: "feishu", enabled: false },
        { id: "qmsg", type: "qmsg", enabled: false }
      ],
      customChannels: [
        {
          id: "custom-1",
          type: "custom",
          name: "Custom",
          enabled: true,
          method: "POST",
          url: "https://example.test/hook",
          headers: { "Content-Type": "application/json" },
          bodyTemplate: "{\"title\":\"{{title}}\",\"message\":\"{{message}}\",\"note\":\"{{errorMessage}}\"}",
          bodyFormat: "json",
          timeoutMs: 3000
        }
      ]
    };

    const deliveries = await dispatchNotifications(makeNotification(), settings, { fetchFn });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(deliveries).toHaveLength(2);
    expect(deliveries.every((delivery) => delivery.ok)).toBe(true);
  });

  test("records failures without stopping later channels", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("pushplus")) return new Response("boom", { status: 500 });
      return new Response("ok", { status: 200 });
    });
    const settings: NotificationSettings = {
      channels: [
        { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" },
        { id: "telegram", type: "telegram", enabled: true, botToken: "bot-token", chatId: "chat-id" },
        { id: "serverchan", type: "serverchan", enabled: false },
        { id: "feishu", type: "feishu", enabled: false },
        { id: "qmsg", type: "qmsg", enabled: false }
      ],
      customChannels: []
    };

    const deliveries = await dispatchNotifications(makeNotification(), settings, { fetchFn });

    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]).toEqual(expect.objectContaining({ channelId: "pushplus", ok: false, status: 500 }));
    expect(deliveries[1]).toEqual(expect.objectContaining({ channelId: "telegram", ok: true }));
  });
});
