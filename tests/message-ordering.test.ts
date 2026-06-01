import { describe, expect, test } from "vitest";
import { appendOptimisticTurnMessages, mergeLoadedMessagesWithCurrent, upsertContextCompactionMarkerMessage } from "../web/src/message-ordering.js";
import type { UiMessage } from "../web/src/types.js";

describe("upsertContextCompactionMarkerMessage", () => {
  test("keeps live compaction markers at their turn position instead of appending them", () => {
    const messages: UiMessage[] = [
      { id: "user-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 },
      { id: "user-2", role: "user", turnId: "turn-2", text: "然后改 README", createdAt: 2000 },
      { id: "assistant-turn-turn-2", role: "assistant", turnId: "turn-2", text: "已修改", createdAt: 2100 }
    ];

    const next = upsertContextCompactionMarkerMessage(messages, {
      id: "compact-turn-1",
      role: "system",
      turnId: "turn-1",
      text: "上下文已压缩",
      createdAt: 1150,
      systemMarker: "contextCompaction"
    });

    expect(next.map((message) => message.id)).toEqual([
      "user-1",
      "compact-turn-1",
      "assistant-turn-turn-1",
      "user-2",
      "assistant-turn-turn-2"
    ]);
  });
});

describe("appendOptimisticTurnMessages", () => {
  test("adds the sent user message and streaming assistant placeholder for a new turn", () => {
    const next = appendOptimisticTurnMessages([], {
      turnId: "turn-2",
      text: "继续",
      attachments: [],
      startedAt: 1000
    });

    expect(next).toEqual([
      {
        id: "user-turn-turn-2",
        role: "user",
        turnId: "turn-2",
        text: "继续",
        createdAt: 1000,
        attachments: [],
        images: []
      },
      {
        id: "assistant-turn-turn-2",
        role: "assistant",
        turnId: "turn-2",
        text: "",
        createdAt: 1000,
        turnStartedAt: 1000,
        isStreaming: true
      }
    ]);
  });
});

describe("mergeLoadedMessagesWithCurrent", () => {
  test("keeps a local pending turn when a forced history reload is stale", () => {
    const current: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 },
      { id: "user-turn-2", role: "user", turnId: "turn-2", text: "继续", createdAt: 2000 },
      { id: "assistant-turn-turn-2", role: "assistant", turnId: "turn-2", text: "", createdAt: 2000, turnStartedAt: 2000, isStreaming: true }
    ];
    const staleLoaded: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 }
    ];

    const next = mergeLoadedMessagesWithCurrent(staleLoaded, current);

    expect(next.map((message) => message.id)).toEqual([
      "user-turn-1",
      "assistant-turn-turn-1",
      "user-turn-2",
      "assistant-turn-turn-2"
    ]);
  });
});
