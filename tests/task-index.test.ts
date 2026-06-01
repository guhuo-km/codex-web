import { describe, expect, test } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { listTaskSummaries } from "../src/tasks/task-index.js";

describe("listTaskSummaries", () => {
  test("lists turn jobs sorted by latest activity first with event counts", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-a", "turn-old");
    events.append({ type: "codex.item/started", threadId: "thread-a", turnId: "turn-old", payload: {} });
    events.recordTurnComplete("thread-a", "turn-old", "completed");
    events.recordTurnStart("thread-b", "turn-new");
    events.append({ type: "codex.item/started", threadId: "thread-b", turnId: "turn-new", payload: {} });

    const result = listTaskSummaries(events);

    expect(result).toEqual([
      expect.objectContaining({
        threadId: "thread-b",
        turnId: "turn-new",
        status: "running",
        eventCount: 2
      }),
      expect.objectContaining({
        threadId: "thread-a",
        turnId: "turn-old",
        status: "completed",
        eventCount: 3
      })
    ]);
  });

  test("can filter by thread id", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-a", "turn-a");
    events.recordTurnStart("thread-b", "turn-b");

    expect(listTaskSummaries(events, { threadId: "thread-a" })).toEqual([
      expect.objectContaining({ threadId: "thread-a", turnId: "turn-a" })
    ]);
  });

  test("marks explicit compact turns", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-1", "turn-compact", "compact");

    expect(listTaskSummaries(events, { threadId: "thread-1" })).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-compact",
        kind: "compact"
      })
    ]);
  });

  test("keeps ordinary turns normal when context compaction is inline with other items", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-1", "turn-normal");
    events.append({
      type: "codex.item/completed",
      threadId: "thread-1",
      turnId: "turn-normal",
      payload: { params: { item: { id: "user-1", type: "userMessage" } } }
    });
    events.append({
      type: "codex.item/completed",
      threadId: "thread-1",
      turnId: "turn-normal",
      payload: { params: { item: { id: "compact-1", type: "contextCompaction" } } }
    });

    expect(listTaskSummaries(events, { threadId: "thread-1" })).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-normal",
        kind: "normal"
      })
    ]);
  });
});
