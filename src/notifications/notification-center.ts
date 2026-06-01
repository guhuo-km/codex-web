import type { BridgeEvent, EventStore } from "../events/event-store.js";
import { dispatchNotifications, type DispatchOptions } from "./dispatchers.js";
import type { CompletionNotification, NotificationStatus, TokenUsageSummary } from "./notification-types.js";
import { NotificationStore, type NotificationSettings, type NotificationSettingsPatch } from "./notification-store.js";

export interface NotificationCenterOptions extends DispatchOptions {}

export class NotificationCenter {
  private readonly store: NotificationStore;
  private readonly tokenUsageByTurn = new Map<string, TokenUsageSummary>();

  constructor(dataDir: string, private readonly options: NotificationCenterOptions = {}) {
    this.store = new NotificationStore(dataDir);
  }

  attach(events: EventStore): () => void {
    return events.subscribe((event) => {
      void this.handleEvent(event).catch((error) => {
        console.error("Failed to dispatch completion notification", error);
      });
    });
  }

  async readSettings(): Promise<NotificationSettings> {
    return this.store.read();
  }

  async updateSettings(patch: NotificationSettingsPatch): Promise<NotificationSettings> {
    return this.store.write(patch);
  }

  async listDeliveries(limit = 50) {
    return this.store.listDeliveries(limit);
  }

  async dispatch(notification: CompletionNotification) {
    const settings = await this.readSettings();
    const deliveries = await dispatchNotifications(notification, settings, this.options);
    for (const delivery of deliveries) {
      await this.store.appendDelivery(delivery);
    }
    return deliveries;
  }

  async handleEvent(event: BridgeEvent): Promise<void> {
    const turnKey = turnKeyFromEvent(event);
    if (event.type === "codex.thread/tokenUsage/updated" || event.type === "thread/tokenUsage/updated") {
      const tokenUsage = readTokenUsage(event);
      if (turnKey && tokenUsage) this.tokenUsageByTurn.set(turnKey, tokenUsage);
      return;
    }
    if (event.type !== "turn.completed") return;

    const notification = this.notificationFromTurnEvent(event);
    if (!notification) return;
    await this.dispatch(notification);
  }

  private notificationFromTurnEvent(event: BridgeEvent): CompletionNotification | undefined {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const status: NotificationStatus | undefined = payload.status === "completed" || payload.status === "failed" || payload.status === "interrupted"
      ? payload.status
      : undefined;
    if (!status) return undefined;
    const turnKey = turnKeyFromEvent(event);
    const tokenUsage = turnKey ? this.tokenUsageByTurn.get(turnKey) : undefined;
    const type = status === "completed" ? "turn.completed" : status === "failed" ? "turn.failed" : "turn.interrupted";
    const title = status === "completed" ? "Codex task completed" : status === "failed" ? "Codex task failed" : "Codex task interrupted";
    const message = formatMessage(status, payload);
    const errorMessage = readErrorMessage(payload);
    return {
      type,
      status,
      title,
      message,
      threadId: event.threadId ?? "",
      turnId: event.turnId ?? "",
      source: "codex-web",
      startedAt: readTimestampMs(payload.startedAt) ?? null,
      completedAt: readTimestampMs(payload.completedAt) ?? null,
      durationMs: readNumber(payload.durationMs) ?? durationFromTimestamps(payload.startedAt, payload.completedAt) ?? null,
      errorMessage,
      tokenUsage: tokenUsage ?? null
    };
  }
}

function turnKeyFromEvent(event: BridgeEvent): string | undefined {
  if (!event.threadId || !event.turnId) return undefined;
  return `${event.threadId}:${event.turnId}`;
}

function readTokenUsage(event: BridgeEvent): TokenUsageSummary | undefined {
  const tokenUsage = (((event.payload as any)?.params?.tokenUsage ?? (event.payload as any)?.tokenUsage)?.last ?? (event.payload as any)?.tokenUsage?.last) as Record<string, unknown> | undefined;
  if (!tokenUsage) return undefined;
  return {
    totalTokens: readNumber(tokenUsage.totalTokens),
    inputTokens: readNumber(tokenUsage.inputTokens),
    cachedInputTokens: readNumber(tokenUsage.cachedInputTokens),
    outputTokens: readNumber(tokenUsage.outputTokens),
    reasoningOutputTokens: readNumber(tokenUsage.reasoningOutputTokens)
  };
}

function formatMessage(status: string, payload: Record<string, unknown>): string {
  const detail = readErrorMessage(payload) ?? readString(payload.message);
  if (status === "completed") return detail ?? "AI task completed";
  if (status === "failed") return detail ?? "AI task failed";
  return detail ?? "AI task interrupted";
}

function readErrorMessage(payload: Record<string, unknown>): string | undefined {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  const message = payload.message;
  if (typeof message === "string" && message.trim()) return message;
  return undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function durationFromTimestamps(startedAt: unknown, completedAt: unknown): number | undefined {
  const startedAtMs = readTimestampMs(startedAt);
  const completedAtMs = readTimestampMs(completedAt);
  if (startedAtMs == null || completedAtMs == null) return undefined;
  return Math.max(0, completedAtMs - startedAtMs);
}
