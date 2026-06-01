import { renderCustomBodyTemplate, type CompletionNotification } from "./notification-types.js";
import type { BuiltInNotificationChannel, CustomNotificationChannel, DeliveryRecord, NotificationSettings } from "./notification-store.js";

export interface DispatchOptions {
  fetchFn?: typeof fetch;
}

export async function dispatchNotifications(notification: CompletionNotification, settings: NotificationSettings, options: DispatchOptions = {}): Promise<DeliveryRecord[]> {
  const fetchFn = options.fetchFn ?? fetch;
  const deliveries: DeliveryRecord[] = [];
  for (const channel of settings.channels) {
    if (!channel.enabled) continue;
    deliveries.push(await dispatchBuiltInChannel(notification, channel, fetchFn));
  }
  for (const channel of settings.customChannels) {
    if (!channel.enabled) continue;
    deliveries.push(await dispatchCustomChannel(notification, channel, fetchFn));
  }
  return deliveries;
}

async function dispatchBuiltInChannel(notification: CompletionNotification, channel: BuiltInNotificationChannel, fetchFn: typeof fetch): Promise<DeliveryRecord> {
  try {
    const result = await postBuiltIn(channel, notification, fetchFn);
    return {
      id: `${Date.now()}-${channel.id}`,
      channelId: channel.id,
      channelType: channel.type,
      ok: result.ok,
      status: result.status,
      responseBody: result.body,
      notificationTitle: notification.title,
      threadId: notification.threadId,
      turnId: notification.turnId,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      id: `${Date.now()}-${channel.id}`,
      channelId: channel.id,
      channelType: channel.type,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      notificationTitle: notification.title,
      threadId: notification.threadId,
      turnId: notification.turnId,
      createdAt: new Date().toISOString()
    };
  }
}

async function dispatchCustomChannel(notification: CompletionNotification, channel: CustomNotificationChannel, fetchFn: typeof fetch): Promise<DeliveryRecord> {
  try {
    const body = renderCustomBodyTemplate(channel.bodyTemplate, notificationToTemplateVariables(notification), channel.bodyFormat);
    const controller = new AbortController();
    const timer = windowTimeout(controller, channel.timeoutMs);
    const response = await fetchFn(channel.url, {
      method: channel.method,
      headers: {
        ...channel.headers,
        ...(channel.bodyFormat === "json" ? { "Content-Type": "application/json" } : {})
      },
      body,
      signal: controller.signal
    });
    clearTimeout(timer);
    const responseBody = await response.text().catch(() => "");
    return {
      id: `${Date.now()}-${channel.id}`,
      channelId: channel.id,
      channelType: "custom",
      ok: response.ok,
      status: response.status,
      responseBody: responseBody.slice(0, 4096),
      error: response.ok ? undefined : `HTTP ${response.status}`,
      notificationTitle: notification.title,
      threadId: notification.threadId,
      turnId: notification.turnId,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      id: `${Date.now()}-${channel.id}`,
      channelId: channel.id,
      channelType: "custom",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      notificationTitle: notification.title,
      threadId: notification.threadId,
      turnId: notification.turnId,
      createdAt: new Date().toISOString()
    };
  }
}

async function postBuiltIn(channel: BuiltInNotificationChannel, notification: CompletionNotification, fetchFn: typeof fetch): Promise<{ ok: boolean; status: number; body: string }> {
  switch (channel.type) {
    case "pushplus": {
      const response = await fetchFn("https://www.pushplus.plus/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: channel.token,
          title: notification.title,
          content: formatNotificationText(notification),
          template: "markdown"
        })
      });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    }
    case "telegram": {
      const response = await fetchFn(`https://api.telegram.org/bot${channel.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: channel.chatId,
          text: formatNotificationText(notification)
        })
      });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    }
    case "serverchan": {
      const response = await fetchFn(`https://sctapi.ftqq.com/${channel.sendKey}.send`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({
          title: notification.title,
          desp: notification.message
        }).toString()
      });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    }
    case "feishu": {
      const response = await fetchFn(channel.webhookUrl ?? "", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: formatNotificationText(notification) }
        })
      });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    }
    case "qmsg": {
      const response = await fetchFn("https://qmsg.zendee.cn/send", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams({
          key: channel.qmsgKey ?? "",
          msg: formatNotificationText(notification)
        }).toString()
      });
      return { ok: response.ok, status: response.status, body: await response.text().catch(() => "") };
    }
  }
}

function formatNotificationText(notification: CompletionNotification): string {
  const details = [
    notification.message,
    notification.threadId ? `thread=${notification.threadId}` : "",
    notification.turnId ? `turn=${notification.turnId}` : "",
    notification.durationMs != null ? `duration=${notification.durationMs}ms` : "",
    notification.errorMessage ? `error=${notification.errorMessage}` : "",
    notification.tokenUsage?.totalTokens != null ? `tokens=${notification.tokenUsage.totalTokens}` : "",
    notification.tokenUsage?.inputTokens != null ? `input=${notification.tokenUsage.inputTokens}` : "",
    notification.tokenUsage?.outputTokens != null ? `output=${notification.tokenUsage.outputTokens}` : ""
  ].filter(Boolean);
  return `${notification.title}${details.length ? `\n${details.join("\n")}` : ""}`;
}

function notificationToTemplateVariables(notification: CompletionNotification) {
  return {
    ...notification,
    tokenUsage: notification.tokenUsage ?? {}
  };
}

function windowTimeout(controller: AbortController, timeoutMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => controller.abort(new Error("Notification request timed out")), timeoutMs);
}
