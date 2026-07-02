import { describe, expect, test } from "vitest";
import { appendOptimisticTurnMessages, messagesBeforeRollbackTarget, mergeLoadedMessagesWithCurrent, upsertContextCompactionMarkerMessage } from "../web/src/message-ordering.js";
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

  test("moves local pending agent events onto the real turn when the turn id arrives", () => {
    const next = appendOptimisticTurnMessages([
      {
        id: "pending-assistant-thread-1",
        role: "assistant",
        text: "",
        isStreaming: true,
        assistantParts: [
          {
            type: "agentEvent",
            id: "agent-event-local-submit",
            event: {
              kind: "status",
              title: "正在提交请求",
              tone: "info",
              details: { path: "/api/threads/thread-1/turns" }
            }
          }
        ]
      }
    ], {
      turnId: "turn-2",
      text: "继续",
      attachments: [],
      startedAt: 1000
    });

    expect(next.map((message) => message.id)).toEqual(["user-turn-turn-2", "assistant-turn-turn-2"]);
    expect(next[1]).toEqual(expect.objectContaining({
      id: "assistant-turn-turn-2",
      assistantParts: [
        expect.objectContaining({
          type: "agentEvent",
          event: expect.objectContaining({ title: "正在提交请求" })
        })
      ]
    }));
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

  test("keeps live agent events when a forced history reload has the same streaming turn but stale parts", () => {
    const current: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "继续", createdAt: 1000 },
      {
        id: "assistant-turn-turn-1",
        role: "assistant",
        turnId: "turn-1",
        text: "正在处理",
        createdAt: 1000,
        isStreaming: true,
        assistantParts: [
          { type: "text", id: "agent-1", text: "正在处理" },
          {
            type: "agentEvent",
            id: "agent-event-2",
            event: {
              kind: "warning",
              title: "stream disconnected attempt 1",
              tone: "warning",
              details: { willRetry: true }
            }
          }
        ]
      }
    ];
    const staleLoaded: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "继续", createdAt: 1000 },
      {
        id: "assistant-turn-turn-1",
        role: "assistant",
        turnId: "turn-1",
        text: "正在处理",
        createdAt: 1000,
        assistantParts: [
          { type: "text", id: "agent-1", text: "正在处理" }
        ]
      }
    ];

    const next = mergeLoadedMessagesWithCurrent(staleLoaded, current);

    expect(next[1]).toEqual(expect.objectContaining({
      id: "assistant-turn-turn-1",
      isStreaming: true,
      assistantParts: [
        expect.objectContaining({ type: "text", id: "agent-1" }),
        expect.objectContaining({
          type: "agentEvent",
          id: "agent-event-2",
          event: expect.objectContaining({
            kind: "warning",
            title: "stream disconnected attempt 1"
          })
        })
      ]
    }));
  });

  test("keeps an optimistic user message when loaded history only has the same turn assistant so far", () => {
    const current: UiMessage[] = [
      { id: "user-turn-turn-2", role: "user", turnId: "turn-2", text: "那帮我整理这张图片", createdAt: 2000 },
      { id: "assistant-turn-turn-2", role: "assistant", turnId: "turn-2", text: "", createdAt: 2000, turnStartedAt: 2000, isStreaming: true }
    ];
    const partiallyLoaded: UiMessage[] = [
      {
        id: "assistant-server-turn-2",
        role: "assistant",
        turnId: "turn-2",
        text: "我会先检查图片内容。",
        createdAt: 2100,
        isStreaming: true
      }
    ];

    const next = mergeLoadedMessagesWithCurrent(partiallyLoaded, current);

    expect(next.map((message) => message.id)).toEqual([
      "user-turn-turn-2",
      "assistant-server-turn-2"
    ]);
  });

  test("keeps a local rollback boundary when a forced history reload is stale", () => {
    const current: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 }
    ];
    const staleLoaded: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 },
      { id: "user-turn-2", role: "user", turnId: "turn-2", text: "继续", createdAt: 2000 },
      { id: "assistant-turn-turn-2", role: "assistant", turnId: "turn-2", text: "旧回复", createdAt: 2100 },
      { id: "user-turn-3", role: "user", turnId: "turn-3", text: "再继续", createdAt: 3000 },
      { id: "assistant-turn-turn-3", role: "assistant", turnId: "turn-3", text: "更旧回复", createdAt: 3100 }
    ];

    const next = mergeLoadedMessagesWithCurrent(staleLoaded, current, { rollbackTargetUserMessageId: "user-turn-2" });

    expect(next.map((message) => message.id)).toEqual(["user-turn-1", "assistant-turn-turn-1"]);
  });
});

describe("messagesBeforeRollbackTarget", () => {
  test("removes the target user turn and its assistant agent event timeline", () => {
    const messages: UiMessage[] = [
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 },
      { id: "user-turn-2", role: "user", turnId: "turn-2", text: "继续", createdAt: 2000 },
      {
        id: "assistant-turn-turn-2",
        role: "assistant",
        turnId: "turn-2",
        text: "",
        createdAt: 2000,
        assistantParts: [
          {
            type: "agentEvent",
            id: "agent-event-1",
            event: {
              kind: "warning",
              title: "Retrying (1/5)...",
              tone: "warning",
              details: { attempt: 1 }
            }
          },
          {
            type: "agentEvent",
            id: "agent-event-2",
            event: {
              kind: "error",
              title: "stream disconnected",
              tone: "danger",
              details: { code: "ECONNRESET" }
            }
          }
        ]
      }
    ];

    const next = messagesBeforeRollbackTarget(messages, "user-turn-2");

    expect(next).toEqual([
      { id: "user-turn-1", role: "user", turnId: "turn-1", text: "先看一下", createdAt: 1000 },
      { id: "assistant-turn-turn-1", role: "assistant", turnId: "turn-1", text: "看完了", createdAt: 1100 }
    ]);
  });
});
