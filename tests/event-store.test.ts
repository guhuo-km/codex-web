import { describe, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";

describe("EventStore", () => {
  test("appends events and lists by thread and sequence", () => {
    const store = new EventStore();

    const first = store.append({ type: "note", threadId: "thread-a", payload: { text: "one" } });
    store.append({ type: "note", threadId: "thread-b", payload: { text: "two" } });
    const third = store.append({ type: "note", threadId: "thread-a", payload: { text: "three" } });

    expect(first.seq).toBe(1);
    expect(third.seq).toBe(3);
    expect(store.list({ threadId: "thread-a" }).map((event) => event.seq)).toEqual([1, 3]);
    expect(store.list({ afterSeq: 1 }).map((event) => event.seq)).toEqual([2, 3]);
  });

  test("tracks running and completed turns", () => {
    const store = new EventStore();

    store.recordTurnStart("thread-1", "turn-1");
    expect(store.getRunningTurns()).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-1",
        status: "running"
      })
    ]);

    store.recordTurnComplete("thread-1", "turn-1", "completed");

    expect(store.getRunningTurns()).toEqual([]);
    expect(store.getTurn("thread-1", "turn-1")).toEqual(
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-1",
        status: "completed"
      })
    );
  });

  test("interrupts stale running turns while preserving protected turns", () => {
    vi.useFakeTimers();
    try {
      const store = new EventStore();
      vi.setSystemTime(new Date("2026-05-31T00:00:00.000Z"));
      store.recordTurnStart("thread-stale", "turn-stale");
      store.recordTurnStart("thread-protected", "turn-protected");

      vi.setSystemTime(new Date("2026-05-31T00:31:00.000Z"));
      const interrupted = store.interruptStaleRunningTurns({
        staleAfterMs: 30 * 60 * 1000,
        protectedTurnKeys: new Set(["thread-protected:turn-protected"])
      });

      expect(interrupted).toEqual([
        expect.objectContaining({
          threadId: "thread-stale",
          turnId: "turn-stale",
          status: "interrupted"
        })
      ]);
      expect(store.getRunningTurns()).toEqual([
        expect.objectContaining({
          threadId: "thread-protected",
          turnId: "turn-protected",
          status: "running"
        })
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("notifies subscribers", () => {
    const store = new EventStore();
    const received: string[] = [];

    const unsubscribe = store.subscribe((event) => received.push(event.type));
    store.append({ type: "alpha", payload: {} });
    unsubscribe();
    store.append({ type: "beta", payload: {} });

    expect(received).toEqual(["alpha"]);
  });

  test("loads persisted events and turns", async () => {
    const persistence = {
      appendEvent: vi.fn(async () => {}),
      upsertTurn: vi.fn(async () => {}),
      readEvents: vi.fn(async () => [{ seq: 7, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: {} }]),
      readTurns: vi.fn(async () => [
        { threadId: "thread-1", turnId: "turn-1", status: "running" as const, startedAt: "2026-05-28T00:00:01.000Z" }
      ])
    };
    const store = new EventStore(persistence);

    await store.load();

    expect(store.list().map((event) => event.seq)).toEqual([7]);
    expect(store.append({ type: "later", payload: {} }).seq).toBe(8);
    expect(store.getRunningTurns()).toHaveLength(1);
  });

  test("retains only recent events without resetting sequence numbers", async () => {
    const persistence = {
      appendEvent: vi.fn(async () => {}),
      upsertTurn: vi.fn(async () => {}),
      readEvents: vi.fn(async () => Array.from({ length: 10 }, (_, index) => ({
        seq: index + 1,
        type: "note",
        createdAt: `2026-05-28T00:00:${String(index).padStart(2, "0")}.000Z`,
        payload: {}
      }))),
      readTurns: vi.fn(async () => [])
    };
    const store = new EventStore(persistence, { maxEvents: 3 });

    await store.load();

    expect(store.list().map((event) => event.seq)).toEqual([8, 9, 10]);
    expect(store.append({ type: "later", payload: {} }).seq).toBe(11);
    expect(store.list().map((event) => event.seq)).toEqual([9, 10, 11]);
    expect(store.stats()).toEqual(expect.objectContaining({
      eventCount: 3,
      retainedEventLimit: 3,
      oldestEventSeq: 9,
      newestEventSeq: 11
    }));
  });

  test("lists recent events with a limit", () => {
    const store = new EventStore();

    for (let index = 0; index < 5; index += 1) {
      store.append({ type: "note", payload: { index } });
    }

    expect(store.list({ limit: 2 }).map((event) => event.seq)).toEqual([4, 5]);
  });
});
