import { describe, expect, test, vi } from "vitest";
import { runSmoke, waitForTurnCompletion } from "../scripts/smoke-live-codex.js";
import { EventStore } from "../src/events/event-store.js";

describe("waitForTurnCompletion", () => {
  test("resolves when matching turn completes", async () => {
    const events = new EventStore();
    const done = waitForTurnCompletion(events, "thread-1", "turn-1", 1000);
    events.append({ type: "codex.turn/completed", threadId: "thread-1", turnId: "turn-1", payload: {} });
    await expect(done).resolves.toBeUndefined();
  });

  test("rejects on timeout", async () => {
    await expect(waitForTurnCompletion(new EventStore(), "thread-1", "turn-1", 1)).rejects.toThrow(
      "Timed out waiting for turn completion"
    );
  });
});

describe("runSmoke", () => {
  test("closes client and manager when turn wait fails", async () => {
    const client = { connect: vi.fn(), close: vi.fn() } as any;
    const manager = {
      ensureRunning: vi.fn(async () => ({ url: "ws://127.0.0.1:1" })),
      shutdown: vi.fn(async () => undefined)
    };
    const bridge = {
      startThread: vi.fn(async () => ({ thread: { id: "thread-1" } })),
      startTurn: vi.fn(async () => ({ turn: { id: "turn-1" } }))
    } as any;

    await expect(runSmoke({
      manager,
      clientFactory: () => client,
      bridgeFactory: () => bridge,
      waitForTurnCompletion: vi.fn(async () => { throw new Error("boom"); }),
      cwd: "D:\\repo"
    })).rejects.toThrow("boom");

    expect(client.close).toHaveBeenCalled();
    expect(manager.shutdown).toHaveBeenCalled();
  });
});
