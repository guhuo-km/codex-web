import { describe, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { attachEventNotifications, NullNotifier } from "../src/notifications/notifier.js";

describe("attachEventNotifications", () => {
  test("notifies when a turn completes", async () => {
    const events = new EventStore();
    const notifier = { notify: vi.fn(async () => undefined) };
    attachEventNotifications(events, notifier);

    events.recordTurnStart("thread-1", "turn-1");
    events.recordTurnComplete("thread-1", "turn-1", "completed");
    await Promise.resolve();

    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "turn.completed",
      title: "Codex task completed",
      threadId: "thread-1",
      turnId: "turn-1"
    }));
  });

  test("null notifier resolves without side effects", async () => {
    await expect(new NullNotifier().notify({ type: "turn.completed", title: "x" })).resolves.toBeUndefined();
  });
});
