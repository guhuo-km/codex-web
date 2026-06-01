import type { BridgeEvent, EventStore } from "../events/event-store.js";

export interface NotificationMessage {
  type: "turn.completed" | "turn.failed" | "turn.interrupted" | "approval.required";
  title: string;
  message?: string;
  threadId?: string;
  turnId?: string;
  source?: string;
}

export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}

export class NullNotifier implements Notifier {
  async notify(_message: NotificationMessage): Promise<void> {}
}

export function attachEventNotifications(events: EventStore, notifier: Notifier): () => void {
  return events.subscribe((event) => {
    const message = notificationFromEvent(event);
    if (!message) return;
    void notifier.notify(message);
  });
}

function notificationFromEvent(event: BridgeEvent): NotificationMessage | undefined {
  if (event.type === "turn.completed") {
    const status = (event.payload as any)?.status;
    if (status === "failed") return base(event, "turn.failed", "Codex task failed");
    if (status === "interrupted") return base(event, "turn.interrupted", "Codex task interrupted");
    return base(event, "turn.completed", "Codex task completed");
  }
  if (event.type.startsWith("codex.request.")) {
    return {
      type: "approval.required",
      title: "Codex needs approval",
      message: event.type,
      source: "codex-web"
    };
  }
  return undefined;
}

function base(event: BridgeEvent, type: NotificationMessage["type"], title: string): NotificationMessage {
  return {
    type,
    title,
    threadId: event.threadId,
    turnId: event.turnId,
    source: "codex-web"
  };
}
