import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NotificationStore } from "../src/notifications/notification-store.js";

describe("NotificationStore", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-notifications-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("returns disabled defaults when no configuration exists", async () => {
    const store = new NotificationStore(dataDir);

    const settings = await store.read();

    expect(settings.channels.map((channel) => [channel.type, channel.enabled])).toEqual([
      ["pushplus", false],
      ["telegram", false],
      ["serverchan", false],
      ["feishu", false],
      ["qmsg", false]
    ]);
    expect(settings.customChannels).toEqual([]);
  });

  test("persists built-in and custom channel settings", async () => {
    const store = new NotificationStore(dataDir);

    await store.write({
      channels: [
        { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" },
        { id: "telegram", type: "telegram", enabled: false, botToken: "bot-token", chatId: "chat-1" }
      ],
      customChannels: [
        {
          id: "custom-1",
          type: "custom",
          name: "Webhook",
          enabled: true,
          method: "POST",
          url: "https://example.test/hook",
          headers: { "X-Test": "yes" },
          bodyTemplate: "{\"text\":\"{{message}}\"}",
          bodyFormat: "json",
          timeoutMs: 5000
        }
      ]
    });

    await expect(store.read()).resolves.toEqual({
      channels: [
        { id: "pushplus", type: "pushplus", enabled: true, token: "push-token" },
        { id: "telegram", type: "telegram", enabled: false, botToken: "bot-token", chatId: "chat-1" },
        { id: "serverchan", type: "serverchan", enabled: false },
        { id: "feishu", type: "feishu", enabled: false },
        { id: "qmsg", type: "qmsg", enabled: false }
      ],
      customChannels: [
        {
          id: "custom-1",
          type: "custom",
          name: "Webhook",
          enabled: true,
          method: "POST",
          url: "https://example.test/hook",
          headers: { "X-Test": "yes" },
          bodyTemplate: "{\"text\":\"{{message}}\"}",
          bodyFormat: "json",
          timeoutMs: 5000
        }
      ]
    });
  });

  test("records delivery attempts with newest entries first", async () => {
    const store = new NotificationStore(dataDir);

    await store.appendDelivery({
      channelId: "pushplus",
      channelType: "pushplus",
      ok: true,
      status: 200,
      responseBody: "ok",
      notificationTitle: "Done"
    });
    await store.appendDelivery({
      channelId: "telegram",
      channelType: "telegram",
      ok: false,
      error: "bad token",
      notificationTitle: "Done"
    });

    const deliveries = await store.listDeliveries(10);
    expect(deliveries).toHaveLength(2);
    expect(deliveries[0]).toEqual(expect.objectContaining({
      channelId: "telegram",
      ok: false,
      error: "bad token"
    }));
    expect(deliveries[1]).toEqual(expect.objectContaining({
      channelId: "pushplus",
      ok: true,
      status: 200
    }));
  });
});
