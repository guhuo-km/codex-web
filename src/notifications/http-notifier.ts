import type { NotificationMessage, Notifier } from "./notifier.js";

export interface HttpNotifierOptions {
  url: string;
  token?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  fetchFn?: typeof fetch;
}

export class HttpNotifier implements Notifier {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpNotifierOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async notify(message: NotificationMessage): Promise<void> {
    const response = await this.fetchFn(this.options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {})
      },
      body: JSON.stringify({
        target_type: this.options.targetType,
        target_id: this.options.targetId,
        title: message.title,
        message: message.message ?? formatMessage(message),
        source: this.options.source ?? message.source ?? "codex-web"
      })
    });
    if (!response.ok) {
      throw new Error(`Notification request failed with status ${response.status}`);
    }
  }
}

function formatMessage(message: NotificationMessage): string {
  return `${message.type}${message.threadId ? ` thread=${message.threadId}` : ""}${message.turnId ? ` turn=${message.turnId}` : ""}`;
}
