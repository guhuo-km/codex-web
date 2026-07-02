import { describe, expect, test } from "vitest";
import { eventsToMessages } from "../web/src/thread-history.js";

describe("agent event stream", () => {
  test("renders collab agent tool calls as subagent parts instead of generic events", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.item/started",
        createdAt: "2026-07-03T00:25:44.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          params: {
            item: {
              id: "subagent-call-1",
              type: "collabAgentToolCall",
              tool: "spawnAgent",
              status: "inProgress",
              senderThreadId: "thread-1",
              receiverThreadIds: ["thread-child"],
              prompt: "只读探索项目结构",
              agentsStates: {
                "thread-child": { status: "pendingInit", message: "Fermat" }
              }
            }
          }
        }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({
        type: "subagent",
        id: "subagent-call-1",
        subagent: expect.objectContaining({
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          prompt: "只读探索项目结构"
        })
      })
    ]);
  });

  test("keeps turn lifecycle out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "turn.started",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { startedAt: "2026-05-31T00:00:00.000Z" }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "我开始处理。" } } }
      },
      {
        seq: 3,
        type: "turn.completed",
        createdAt: "2026-05-31T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { status: "completed", completedAt: "2026-05-31T00:00:02.000Z" }
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        turnId: "turn-1",
        text: "我开始处理。",
        assistantParts: [
          expect.objectContaining({ type: "text", id: "agent-1", text: "我开始处理。" })
        ],
        turnStartedAt: Date.parse("2026-05-31T00:00:00.000Z"),
        turnCompletedAt: Date.parse("2026-05-31T00:00:02.000Z")
      })
    ]);
  });

  test("keeps model request status out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.agent/status",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          kind: "status",
          phase: "model_request",
          message: "正在请求模型"
        }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "我开始处理。" } } }
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        turnId: "turn-1",
        text: "我开始处理。",
        assistantParts: [
          expect.objectContaining({ type: "text", id: "agent-1", text: "我开始处理。" })
        ]
      })
    ]);
  });

  test("keeps thread status changed notifications out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.thread/status/changed",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          method: "thread/status/changed",
          params: { threadId: "thread-1", status: "running" }
        }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "你好。" } } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ type: "text", id: "agent-1", text: "你好。" })
    ]);
  });

  test("keeps turn diff update notifications out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.turn/diff/updated",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          method: "turn/diff/updated",
          params: { threadId: "thread-1", turnId: "turn-1" }
        }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "文件已写入。" } } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ type: "text", id: "agent-1", text: "文件已写入。" })
    ]);
  });

  test("keeps thread goal sync notifications out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.thread/goal/updated",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          method: "thread/goal/updated",
          params: {
            threadId: "thread-1",
            goal: { objective: "完善产品", status: "active" }
          }
        }
      },
      {
        seq: 2,
        type: "codex.thread/goal/cleared",
        createdAt: "2026-05-31T00:00:00.500Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          method: "thread/goal/cleared",
          params: { threadId: "thread-1" }
        }
      },
      {
        seq: 3,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "继续处理。" } } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ type: "text", id: "agent-1", text: "继续处理。" })
    ]);
  });

  test("keeps standalone failed completion as message status instead of an agent event", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "turn.completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          status: "failed",
          error: { message: "model request failed", code: "ECONNRESET" }
        }
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        turnId: "turn-1",
        statusText: "model request failed",
        statusTone: "danger"
      })
    ]);
    expect(messages[0]?.assistantParts).toBeUndefined();
  });

  test("keeps repeated retry warnings in turn order without deduping", () => {
    const retryPayload = (attempt: number) => ({
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: true,
        error: {
          message: `stream disconnected attempt ${attempt}`,
          additionalDetails: "offline"
        }
      }
    });

    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.error",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: retryPayload(1)
      },
      {
        seq: 2,
        type: "codex.error",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: retryPayload(2)
      }
    ]);

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      turnId: "turn-1",
      assistantParts: [
        expect.objectContaining({
          type: "agentEvent",
          event: expect.objectContaining({
            kind: "warning",
            tone: "warning",
            title: "stream disconnected attempt 1",
            message: "offline"
          })
        }),
        expect.objectContaining({
          type: "agentEvent",
          event: expect.objectContaining({
            kind: "warning",
            tone: "warning",
            title: "stream disconnected attempt 2",
            message: "offline"
          })
        })
      ]
    }));
  });

  test("maps warnings to warning and model events to low weight status", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.warning",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { message: "Network degraded", details: "Provider returned intermittent 503" } }
      },
      {
        seq: 2,
        type: "codex.configWarning",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { message: "Invalid config" } }
      },
      {
        seq: 3,
        type: "codex.guardianWarning",
        createdAt: "2026-05-31T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { message: "Guardian warning" } }
      },
      {
        seq: 4,
        type: "codex.model/rerouted",
        createdAt: "2026-05-31T00:00:03.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { reason: "primary model unavailable", fromModel: "gpt-5", toModel: "gpt-5-mini" } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ kind: "warning", tone: "warning", title: "Network degraded" }) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "warning", tone: "warning", title: "Invalid config" }) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "warning", tone: "warning", title: "Guardian warning" }) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "status", tone: "muted", title: "primary model unavailable" }) })
    ]);
  });

  test("maps MCP startup errors to warning", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.mcpServer/startupStatus/updated",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          params: {
            server: "github",
            status: "failed",
            error: "spawn failed"
          }
        }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "warning",
          tone: "warning",
          title: "MCP 服务启动错误",
          details: expect.objectContaining({
            params: expect.objectContaining({
              server: "github",
              error: "spawn failed"
            })
          })
        })
      })
    ]);
  });

  test("keeps successful MCP startup status out of assistant event parts", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.mcpServer/startupStatus/updated",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          method: "mcpServer/startupStatus/updated",
          params: {
            server: "chrome-devtools",
            status: "ready",
            error: null
          }
        }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "你好。" } } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ type: "text", id: "agent-1", text: "你好。" })
    ]);
  });

  test("maps non-retry errors and realtime network errors to error", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.error",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { error: { message: "Request failed with 503" } } }
      },
      {
        seq: 2,
        type: "codex.thread/realtime/error",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { message: "Realtime disconnected" } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ kind: "error", tone: "danger", title: "Request failed with 503" }) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "error", tone: "danger", title: "Realtime disconnected" }) })
    ]);
  });

  test("restores approval requests and resolutions as low weight status records", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.request.item/commandExecution/requestApproval",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          id: 42,
          method: "item/commandExecution/requestApproval",
          params: { threadId: "thread-1", turnId: "turn-1", command: "npm test" }
        }
      },
      {
        seq: 2,
        type: "codex.serverRequest/resolved",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { requestId: 42, method: "item/commandExecution/requestApproval", decision: "accept" }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ kind: "status", tone: "muted", title: "需要用户批准" }) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "status", tone: "muted", title: "用户批准已处理" }) })
    ]);
  });

  test("restores unknown turn and item events as low weight status records with raw details", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.provider/backoff",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { reason: "upstream overloaded", retryAfterMs: 1500 } }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { id: "item-1", type: "providerDiagnostic", title: "Provider diagnostic", details: { httpStatus: 503 } } } }
      },
      {
        seq: 3,
        type: "codex.rawResponseItem/started",
        createdAt: "2026-05-31T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { id: "raw-1", type: "response_diagnostic", title: "Provider diagnostic started", details: { phase: "connect" } } } }
      }
    ]);

    expect(messages[0]?.assistantParts).toEqual([
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "status",
          tone: "muted",
          title: "upstream overloaded",
          details: expect.objectContaining({ params: expect.objectContaining({ retryAfterMs: 1500 }) })
        })
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "status",
          tone: "muted",
          title: "Provider diagnostic",
          details: expect.objectContaining({ params: expect.objectContaining({ item: expect.objectContaining({ type: "providerDiagnostic" }) }) })
        })
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          kind: "status",
          tone: "muted",
          title: "Provider diagnostic started",
          details: expect.objectContaining({ params: expect.objectContaining({ item: expect.objectContaining({ type: "response_diagnostic" }) }) })
        })
      })
    ]);
  });
});
