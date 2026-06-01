import { Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  NotificationBuiltInChannel,
  NotificationCustomChannel,
  NotificationDeliveryRecord,
  NotificationSettings
} from "../types";

type NotificationTab = "channels" | "custom" | "deliveries";
type EditableCustomChannel = NotificationCustomChannel & { headersText: string };

export const DEFAULT_CUSTOM_BODY_TEMPLATE = `{
  "title": "{{title}}",
  "message": "{{message}}\\nthread={{threadId}}\\nturn={{turnId}}\\nduration={{durationMs}}ms\\nerror={{errorMessage}}\\ntokens={{tokenUsage.totalTokens}}\\ninput={{tokenUsage.inputTokens}}\\noutput={{tokenUsage.outputTokens}}",
  "source": "{{source}}"
}`;

interface EditableNotificationSettings {
  channels: NotificationBuiltInChannel[];
  customChannels: EditableCustomChannel[];
}

const CHANNEL_LABELS: Record<NotificationBuiltInChannel["type"], string> = {
  pushplus: "PushPlus",
  telegram: "Telegram",
  serverchan: "Server酱",
  feishu: "飞书机器人",
  qmsg: "Qmsg"
};

const CHANNEL_FIELDS: Record<NotificationBuiltInChannel["type"], Array<{ key: keyof NotificationBuiltInChannel; label: string; placeholder: string }>> = {
  pushplus: [{ key: "token", label: "Token", placeholder: "PushPlus Token" }],
  telegram: [
    { key: "botToken", label: "Bot Token", placeholder: "123456:ABC" },
    { key: "chatId", label: "Chat ID", placeholder: "-100..." }
  ],
  serverchan: [{ key: "sendKey", label: "SendKey", placeholder: "SCT..." }],
  feishu: [{ key: "webhookUrl", label: "Webhook URL", placeholder: "https://open.feishu.cn/open-apis/bot/v2/hook/..." }],
  qmsg: [{ key: "qmsgKey", label: "Qmsg Key", placeholder: "Qmsg Key" }]
};

export function NotificationSettingsPanel() {
  const [tab, setTab] = useState<NotificationTab>("channels");
  const [settings, setSettings] = useState<EditableNotificationSettings | null>(null);
  const [deliveries, setDeliveries] = useState<NotificationDeliveryRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [nextSettings, nextDeliveries] = await Promise.all([
          api.notifications(),
          api.notificationDeliveries(25)
        ]);
        if (cancelled) return;
        setSettings(toEditableSettings(nextSettings));
        setDeliveries(nextDeliveries);
        setError(null);
        setLoaded(true);
      } catch (loadError) {
        if (cancelled) return;
        console.error("Failed to load notification settings", loadError);
        setError("通知配置加载失败");
        setLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !dirty || !settings) return;
    const timer = window.setTimeout(() => {
      void saveSettings(settings);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [dirty, loaded, settings]);

  const enabledCount = useMemo(() => {
    if (!settings) return 0;
    return settings.channels.filter((channel) => channel.enabled).length + settings.customChannels.filter((channel) => channel.enabled).length;
  }, [settings]);

  function updateChannel(id: string, patch: Partial<NotificationBuiltInChannel>) {
    setSettings((current) => current ? {
      ...current,
      channels: current.channels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel)
    } : current);
    setDirty(true);
  }

  function updateCustomChannel(id: string, patch: Partial<EditableCustomChannel>) {
    setSettings((current) => current ? {
      ...current,
      customChannels: current.customChannels.map((channel) => channel.id === id ? { ...channel, ...patch } : channel)
    } : current);
    setDirty(true);
  }

  function addCustomChannel() {
    const id = `custom-${Date.now()}`;
    setSettings((current) => {
      const base = current ?? toEditableSettings({ channels: [], customChannels: [] });
      return {
        ...base,
        customChannels: [
          ...base.customChannels,
          {
            id,
            type: "custom",
            name: "自定义渠道",
            enabled: false,
            method: "POST",
            url: "",
            headers: {},
            headersText: "{\n  \"Content-Type\": \"application/json\"\n}",
            bodyTemplate: DEFAULT_CUSTOM_BODY_TEMPLATE,
            bodyFormat: "json",
            timeoutMs: 10000
          }
        ]
      };
    });
    setDirty(true);
  }

  function removeCustomChannel(id: string) {
    setSettings((current) => current ? {
      ...current,
      customChannels: current.customChannels.filter((channel) => channel.id !== id)
    } : current);
    setDirty(true);
  }

  async function saveSettings(nextSettings: EditableNotificationSettings) {
    setSaving(true);
    try {
      const serialized = fromEditableSettings(nextSettings);
      const updated = await api.updateNotifications(serialized);
      setSettings(toEditableSettings(updated));
      setDirty(false);
      setError(null);
    } catch (saveError) {
      console.error("Failed to save notification settings", saveError);
      setError(saveError instanceof Error ? saveError.message : "通知配置保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await api.testNotifications({ message: "Notification test" });
      setDeliveries(await api.notificationDeliveries(25));
      setError(null);
    } catch (testError) {
      console.error("Failed to test notification channels", testError);
      setError(testError instanceof Error ? testError.message : "测试发送失败");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="notification-settings">
      <div className="settings-subnav" role="tablist" aria-label="通知设置">
        <button type="button" className={tab === "channels" ? "active" : ""} onClick={() => setTab("channels")}>渠道</button>
        <button type="button" className={tab === "custom" ? "active" : ""} onClick={() => setTab("custom")}>自定义</button>
        <button type="button" className={tab === "deliveries" ? "active" : ""} onClick={() => setTab("deliveries")}>记录</button>
      </div>

      <div className="notification-toolbar">
        <span>{loaded ? `${enabledCount} 个渠道已启用` : "正在加载通知配置..."}</span>
        <button type="button" onClick={() => void sendTest()} disabled={testing || enabledCount === 0}>
          <Send size={14} />
          <span>{testing ? "发送中" : "测试发送"}</span>
        </button>
      </div>

      {error ? <div className="notification-error">{error}</div> : null}
      {saving ? <div className="notification-muted">正在保存...</div> : null}

      {tab === "channels" ? (
        <div className="notification-channel-list">
          {settings?.channels.map((channel) => (
            <section className="notification-card" key={channel.id}>
              <header>
                <strong>{CHANNEL_LABELS[channel.type]}</strong>
                <label className="notification-toggle">
                  <span>{channel.enabled ? "已启用" : "关闭"}</span>
                  <input type="checkbox" checked={channel.enabled} onChange={(event) => updateChannel(channel.id, { enabled: event.target.checked })} />
                </label>
              </header>
              <div className="notification-field-grid">
                {CHANNEL_FIELDS[channel.type].map((field) => (
                  <label key={String(field.key)}>
                    <span>{field.label}</span>
                    <input
                      value={String(channel[field.key] ?? "")}
                      placeholder={field.placeholder}
                      onChange={(event) => updateChannel(channel.id, { [field.key]: event.target.value } as Partial<NotificationBuiltInChannel>)}
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "custom" ? (
        <div className="notification-channel-list">
          <button className="notification-add-button" type="button" onClick={addCustomChannel}>
            <Plus size={14} />
            <span>添加自定义渠道</span>
          </button>
          {settings?.customChannels.map((channel) => (
            <section className="notification-card custom" key={channel.id}>
              <header>
                <input value={channel.name} onChange={(event) => updateCustomChannel(channel.id, { name: event.target.value })} />
                <label className="notification-toggle">
                  <span>{channel.enabled ? "已启用" : "关闭"}</span>
                  <input type="checkbox" checked={channel.enabled} onChange={(event) => updateCustomChannel(channel.id, { enabled: event.target.checked })} />
                </label>
                <button className="icon-button" type="button" onClick={() => removeCustomChannel(channel.id)} title="删除渠道" aria-label="删除渠道">
                  <Trash2 size={14} />
                </button>
              </header>
              <div className="notification-field-grid">
                <label>
                  <span>Method</span>
                  <select value={channel.method} onChange={(event) => updateCustomChannel(channel.id, { method: event.target.value })}>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                  </select>
                </label>
                <label>
                  <span>URL</span>
                  <input value={channel.url} onChange={(event) => updateCustomChannel(channel.id, { url: event.target.value })} />
                </label>
                <label>
                  <span>Body</span>
                  <select value={channel.bodyFormat} onChange={(event) => updateCustomChannel(channel.id, { bodyFormat: event.target.value as "text" | "json" })}>
                    <option value="json">JSON</option>
                    <option value="text">Text</option>
                  </select>
                </label>
                <label>
                  <span>Timeout</span>
                  <input type="number" min={1000} max={120000} step={1000} value={channel.timeoutMs} onChange={(event) => updateCustomChannel(channel.id, { timeoutMs: Number(event.target.value) })} />
                </label>
              </div>
              <label className="notification-wide-field">
                <span>Headers JSON</span>
                <textarea value={channel.headersText} onChange={(event) => updateCustomChannel(channel.id, { headersText: event.target.value })} />
              </label>
              <label className="notification-wide-field">
                <span>Body Template</span>
                <textarea value={channel.bodyTemplate} onChange={(event) => updateCustomChannel(channel.id, { bodyTemplate: event.target.value })} />
              </label>
            </section>
          ))}
        </div>
      ) : null}

      {tab === "deliveries" ? (
        <div className="notification-delivery-list">
          {deliveries.length ? deliveries.map((delivery) => (
            <div className={delivery.ok ? "notification-delivery" : "notification-delivery failed"} key={delivery.id}>
              <span>
                <strong>{delivery.notificationTitle}</strong>
                <small>{delivery.channelType} · {delivery.status ?? (delivery.ok ? "ok" : "error")} · {formatTime(delivery.createdAt)}</small>
              </span>
              <code>{delivery.error ?? delivery.responseBody ?? ""}</code>
            </div>
          )) : <div className="notification-muted">暂无发送记录</div>}
        </div>
      ) : null}
    </div>
  );
}

function toEditableSettings(settings: NotificationSettings): EditableNotificationSettings {
  return {
    channels: settings.channels,
    customChannels: settings.customChannels.map((channel) => ({
      ...channel,
      headersText: JSON.stringify(channel.headers ?? {}, null, 2)
    }))
  };
}

function fromEditableSettings(settings: EditableNotificationSettings): NotificationSettings {
  return {
    channels: settings.channels,
    customChannels: settings.customChannels.map(({ headersText, ...channel }) => ({
      ...channel,
      headers: parseHeaders(headersText)
    }))
  };
}

function parseHeaders(text: string): Record<string, string> {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Headers JSON 必须是对象");
  return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString();
}
