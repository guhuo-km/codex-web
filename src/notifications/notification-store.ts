import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type BuiltInChannelType = "pushplus" | "telegram" | "serverchan" | "feishu" | "qmsg";

export interface BuiltInNotificationChannel {
  id: string;
  type: BuiltInChannelType;
  enabled: boolean;
  token?: string;
  botToken?: string;
  chatId?: string;
  sendKey?: string;
  webhookUrl?: string;
  qmsgKey?: string;
}

export interface CustomNotificationChannel {
  id: string;
  type: "custom";
  name: string;
  enabled: boolean;
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyTemplate: string;
  bodyFormat: "text" | "json";
  timeoutMs: number;
}

export interface NotificationSettings {
  channels: BuiltInNotificationChannel[];
  customChannels: CustomNotificationChannel[];
}

export interface DeliveryRecord {
  id: string;
  channelId: string;
  channelType: BuiltInChannelType | "custom";
  ok: boolean;
  status?: number;
  responseBody?: string;
  error?: string;
  notificationTitle: string;
  threadId?: string;
  turnId?: string;
  createdAt: string;
}

export interface NotificationSettingsPatch {
  channels?: BuiltInNotificationChannel[];
  customChannels?: CustomNotificationChannel[];
}

const BUILT_IN_CHANNELS: Array<Pick<BuiltInNotificationChannel, "id" | "type">> = [
  { id: "pushplus", type: "pushplus" },
  { id: "telegram", type: "telegram" },
  { id: "serverchan", type: "serverchan" },
  { id: "feishu", type: "feishu" },
  { id: "qmsg", type: "qmsg" }
];

export class NotificationStore {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<NotificationSettings> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      return normalizeSettings(JSON.parse(text));
    } catch (error: any) {
      if (error?.code === "ENOENT") return defaultSettings();
      throw error;
    }
  }

  async write(patch: NotificationSettingsPatch): Promise<NotificationSettings> {
    const current = await this.read();
    const next = normalizeSettings({ ...current, ...patch });
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  async appendDelivery(record: Omit<DeliveryRecord, "id" | "createdAt">): Promise<DeliveryRecord> {
    const delivery: DeliveryRecord = {
      ...record,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      createdAt: new Date().toISOString()
    };
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(this.deliveryFilePath(), `${JSON.stringify(delivery)}\n`, "utf8");
    return delivery;
  }

  async listDeliveries(limit = 50): Promise<DeliveryRecord[]> {
    try {
      const text = await readFile(this.deliveryFilePath(), "utf8");
      const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as DeliveryRecord);
      return records.slice(-limit).reverse();
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private filePath(): string {
    return join(this.dataDir, "notifications.json");
  }

  private deliveryFilePath(): string {
    return join(this.dataDir, "notification-deliveries.jsonl");
  }
}

function defaultSettings(): NotificationSettings {
  return {
    channels: BUILT_IN_CHANNELS.map((channel) => ({ ...channel, enabled: false })),
    customChannels: []
  };
}

function normalizeSettings(input: unknown): NotificationSettings {
  const value = input as Partial<NotificationSettings>;
  const channelsById = new Map((value.channels ?? []).filter(Boolean).map((channel) => [channel.id, channel]));
  return {
    channels: BUILT_IN_CHANNELS.map((channel) => normalizeBuiltInChannel(channel, channelsById.get(channel.id))),
    customChannels: Array.isArray(value.customChannels) ? value.customChannels.map(normalizeCustomChannel) : []
  };
}

function normalizeBuiltInChannel(base: Pick<BuiltInNotificationChannel, "id" | "type">, input?: Partial<BuiltInNotificationChannel>): BuiltInNotificationChannel {
  const enabled = Boolean(input?.enabled);
  const channel: BuiltInNotificationChannel = { ...base, enabled };
  if (input?.token) channel.token = input.token;
  if (input?.botToken) channel.botToken = input.botToken;
  if (input?.chatId) channel.chatId = input.chatId;
  if (input?.sendKey) channel.sendKey = input.sendKey;
  if (input?.webhookUrl) channel.webhookUrl = input.webhookUrl;
  if (input?.qmsgKey) channel.qmsgKey = input.qmsgKey;
  return channel;
}

function normalizeCustomChannel(input: Partial<CustomNotificationChannel>): CustomNotificationChannel {
  return {
    id: typeof input.id === "string" && input.id.trim() ? input.id : `custom-${Date.now()}`,
    type: "custom",
    name: typeof input.name === "string" && input.name.trim() ? input.name : "自定义渠道",
    enabled: Boolean(input.enabled),
    method: typeof input.method === "string" && input.method.trim() ? input.method.toUpperCase() : "POST",
    url: typeof input.url === "string" ? input.url : "",
    headers: isRecordOfStrings(input.headers) ? input.headers : {},
    bodyTemplate: typeof input.bodyTemplate === "string" ? input.bodyTemplate : "",
    bodyFormat: input.bodyFormat === "json" ? "json" : "text",
    timeoutMs: clampNumber(input.timeoutMs, 1000, 120000, 10000)
  };
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
