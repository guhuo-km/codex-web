import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { ChatPane } from "../web/src/components/ChatPane.js";
import { StatusBar } from "../web/src/components/StatusBar.js";
import type { ThreadGoal, UiThread } from "../web/src/types.js";

describe("right side drawer UI", () => {
  test("keeps the top-right status bar action as refresh on mobile", () => {
    const html = renderToStaticMarkup(React.createElement(StatusBar, {
      title: "Current thread",
      status: { connected: true },
      tasks: [],
      onRefresh: vi.fn(),
      capabilities: null,
      onRefreshCapabilities: vi.fn(),
      sidebarCollapsed: true,
      onToggleSidebar: vi.fn(),
      isMobileLayout: true
    }));

    expect(html).toContain("aria-label=\"刷新\"");
    expect(html).not.toContain("显示快捷跳转");
    expect(html).not.toContain("收起快捷跳转");
  });

  test("keeps the desktop jump rail beside the conversation", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: sampleThread,
      isMobileLayout: false
    }));

    expect(html).toContain("conversation-jump-rail");
  });

  test("does not render pending steer messages inside the conversation stream", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: streamingThread,
      isGenerating: true,
      queuedSteers: [{ id: "steer-1", text: "还没追加的引导", status: "submitted" }]
    }));

    expect(html).not.toContain("还没追加的引导");
    expect(html).not.toContain("已提交，等待追加");
  });

  test("renders confirmed steer messages inside the conversation stream", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: confirmedSteerThread,
      isGenerating: true
    }));

    expect(html).toContain("已经进入历史的引导");
    expect(html).toContain("已追加");
  });

  test("renders command behavior explanations inside tool cards without a label", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: explainedToolThread,
      isGenerating: true
    }));

    expect(html).toContain("tool-call-explanation");
    expect(html).toContain("读取 package.json 的完整文本内容。");
    expect(html).toContain("Get-Content -Raw package.json");
    expect(html).not.toContain("AI解释");
    expect(html.indexOf("读取 package.json 的完整文本内容。")).toBeLessThan(html.indexOf("Get-Content -Raw package.json"));
  });

  test("renders agent event disclosures without native details layout", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: agentEventThread,
      isGenerating: true
    }));

    expect(html).toContain("agent-event-disclosure");
    expect(html).toContain("aria-expanded=\"false\"");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("<summary");
  });

  test("renders subagent calls as first-class call cards", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: subagentThread,
      isGenerating: true
    }));

    expect(html).toContain("tool-call-card unframed completed");
    expect(html).toContain("/icons/agent.svg");
    expect(html).toContain("启动子代理");
    expect(html).toContain("Fermat");
    expect(html).toContain("tool-call-detail");
    expect(html).not.toContain("codex.item/started");
  });

  test("groups consecutive tool and subagent calls in the same call group", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: mixedCallThread,
      isGenerating: true,
      toolGroupCollapseMode: "alwaysExpanded"
    }));

    expect(html.match(/class="tool-call-group /g)?.length ?? 0).toBe(1);
    expect(html).toContain("tool-call-group-body");
    expect(html).toContain("tool-call-card unframed completed");
    expect(html).toContain("/icons/agent.svg");
    expect(html.indexOf("Get-Content package.json")).toBeLessThan(html.indexOf("启动子代理"));
    expect(html.indexOf("启动子代理")).toBeLessThan(html.indexOf("Get-ChildItem src"));
  });

  test("defaults tool and subagent call cards to unframed while keeping details", () => {
    const commandHtml = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: explainedToolThread,
      isGenerating: true
    }));
    const subagentHtml = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: subagentThread,
      isGenerating: true
    }));

    expect(commandHtml).toContain("tool-call-card unframed");
    expect(commandHtml).toContain("tool-call-detail");
    expect(commandHtml).toContain("Get-Content -Raw package.json");
    expect(subagentHtml).toContain("tool-call-card unframed completed");
    expect(subagentHtml).toContain("tool-call-detail");
    expect(subagentHtml).toContain("只读探索项目结构");
  });

  test("renders an enter button for subagent calls when the child thread is known", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: subagentThread,
      isGenerating: true,
      subagentThreads: [childSubagentThread],
      onSelectSubagent: vi.fn()
    }));

    expect(html).toContain("tool-call-trailing-action");
    expect(html).toContain("aria-label=\"打开子代理会话 thread-child\"");
    expect(html).toContain("进入子代理会话 thread-child");
    expect(html).toContain("lucide-panel-right-open");
  });

  test("can render selected tool call cards without outer frames", () => {
    const subagentHtml = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: subagentThread,
      isGenerating: true,
      toolCardFrames: {
        command: false,
        fileChange: true,
        mcp: true,
        dynamic: true,
        webSearch: true,
        image: true,
        plan: true,
        subagent: false,
        other: true
      }
    }));
    const commandHtml = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: explainedToolThread,
      isGenerating: true,
      toolCardFrames: {
        command: false,
        fileChange: true,
        mcp: true,
        dynamic: true,
        webSearch: true,
        image: true,
        plan: true,
        subagent: true,
        other: true
      }
    }));

    expect(subagentHtml).toContain("tool-call-card unframed completed");
    expect(commandHtml).toContain("tool-call-card unframed");
  });

  test("renders the right drawer handle on desktop even when there is only one turn", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: singleTurnThread,
      isMobileLayout: false
    }));

    expect(html).toContain("right-drawer-toggle");
    expect(html).toContain("aria-label=\"展开右侧栏\"");
    expect(html).toContain("lucide-panel-right-open");
  });

  test("keeps the right drawer generic and moves the existing jump rail into it on mobile", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: sampleThread,
      isMobileLayout: true,
      mobileRightDrawerOpen: true
    }));

    expect(html).not.toContain("conversation-jump-rail mobile");
    expect(html).toContain("right-drawer");
    expect(html).toContain("right-drawer-jump-host");
    expect(html).toContain("conversation-jump-rail");
    expect(html).not.toContain("右侧面板");
    expect(html).not.toContain("快捷跳转");
    expect(html).not.toContain("项");
  });

  test("does not keep stale mobile jump rail state calls in App", () => {
    const source = readFileSync(join(process.cwd(), "web/src/App.tsx"), "utf8");

    expect(source).not.toContain("setMobileJumpRailOpen");
    expect(source).not.toContain("mobileJumpRailOpen");
  });

  test("renders goal controls inside the generic right drawer", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: sampleThread,
      isMobileLayout: false,
      mobileRightDrawerOpen: true,
      goal: activeGoal,
      onPauseGoal: vi.fn(),
      onClearGoal: vi.fn(),
      onCreateGoal: vi.fn(),
      onResumeGoal: vi.fn()
    }));

    expect(html).toContain("right-drawer-goal");
    expect(html).toContain("构建目标面板");
    expect(html).toContain("目标进行中");
    expect(html).toContain("暂停");
    expect(html).toContain("清除");
    expect(html).not.toContain("右侧面板");
  });

  test("renders a visible goal form in the drawer even when no goal exists", () => {
    const html = renderToStaticMarkup(React.createElement(ChatPane, {
      thread: sampleThread,
      isMobileLayout: false,
      mobileRightDrawerOpen: true,
      goal: null,
      onCreateGoal: vi.fn()
    }));

    expect(html).toContain("right-drawer-body");
    expect(html).toContain("right-drawer-goal");
    expect(html).toContain("输入目标...");
    expect(html).toContain("开始目标");
  });

  test("keeps the drawer handle outside the opened drawer width", () => {
    const css = readFileSync(join(process.cwd(), "web/src/styles.css"), "utf8");

    expect(css).toContain(".chat-pane {\n  --right-drawer-width: clamp(280px, 28vw, 360px);");
    expect(css).toContain("right: calc(var(--right-drawer-width) + max(0px, env(safe-area-inset-right)))");
    expect(css).not.toContain("right: var(--right-drawer-width, min(360px, 28vw));");
  });
});

const sampleThread: UiThread = {
  id: "thread-1",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-1", role: "user", text: "first request", createdAt: 1, turnId: "turn-1" },
    { id: "assistant-1", role: "assistant", text: "first response", createdAt: 2, turnId: "turn-1" },
    { id: "user-2", role: "user", text: "second request", createdAt: 3, turnId: "turn-2" },
    { id: "assistant-2", role: "assistant", text: "second response", createdAt: 4, turnId: "turn-2" }
  ]
};

const singleTurnThread: UiThread = {
  id: "thread-single",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-single", role: "user", text: "only request", createdAt: 1, turnId: "turn-single" },
    { id: "assistant-single", role: "assistant", text: "only response", createdAt: 2, turnId: "turn-single" }
  ]
};

const streamingThread: UiThread = {
  id: "thread-streaming",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-streaming", role: "user", text: "request", createdAt: 1, turnId: "turn-streaming" },
    { id: "assistant-streaming", role: "assistant", text: "working", createdAt: 2, turnId: "turn-streaming", isStreaming: true }
  ]
};

const confirmedSteerThread: UiThread = {
  id: "thread-steer",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-steer", role: "user", text: "request", createdAt: 1, turnId: "turn-steer" },
    {
      id: "assistant-steer",
      role: "assistant",
      text: "working",
      createdAt: 2,
      turnId: "turn-steer",
      isStreaming: true,
      steerMessages: [{ id: "steer-confirmed", text: "已经进入历史的引导", status: "sent" }],
      assistantParts: [{ type: "steer", id: "steer-confirmed", text: "已经进入历史的引导", status: "sent" }]
    }
  ]
};

const explainedToolThread: UiThread = {
  id: "thread-tool-explained",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-tool", role: "user", text: "check package", createdAt: 1, turnId: "turn-tool" },
    {
      id: "assistant-tool",
      role: "assistant",
      text: "",
      createdAt: 2,
      turnId: "turn-tool",
      assistantParts: [{
        type: "tool",
        id: "cmd-1",
        toolCall: {
          id: "cmd-1",
          type: "commandExecution",
          command: "Get-Content -Raw package.json",
          commandExplanation: "读取 package.json 的完整文本内容。",
          status: "completed",
          durationMs: 128
        }
      }]
    }
  ]
};

const agentEventThread: UiThread = {
  id: "thread-agent-event",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-agent-event", role: "user", text: "run", createdAt: 1, turnId: "turn-agent-event" },
    {
      id: "assistant-agent-event",
      role: "assistant",
      text: "",
      createdAt: 2,
      turnId: "turn-agent-event",
      assistantParts: [{
        type: "agentEvent",
        id: "event-1",
        event: {
          kind: "status",
          title: "codex.item/started",
          tone: "info",
          createdAt: Date.parse("2026-07-03T00:25:44.000Z"),
          details: { item: { type: "commandExecution", command: "Get-Content package.json" } }
        }
      }]
    }
  ]
};

const subagentThread: UiThread = {
  id: "thread-subagent",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-subagent", role: "user", text: "spawn", createdAt: 1, turnId: "turn-subagent" },
    {
      id: "assistant-subagent",
      role: "assistant",
      text: "",
      createdAt: 2,
      turnId: "turn-subagent",
      assistantParts: [{
        type: "subagent",
        id: "subagent-call-1",
        subagent: {
          id: "subagent-call-1",
          type: "collabAgentToolCall",
          tool: "spawnAgent",
          status: "completed",
          senderThreadId: "thread-subagent",
          receiverThreadIds: ["thread-child"],
          prompt: "只读探索项目结构",
          agentsStates: {
            "thread-child": { status: "completed", message: "Fermat" }
          },
          details: {
            id: "subagent-call-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent"
          }
        }
      }]
    }
  ]
};

const mixedCallThread: UiThread = {
  id: "thread-mixed-calls",
  cwd: "D:\\repo",
  title: "Thread",
  updatedAt: Date.now(),
  isDraft: false,
  messages: [
    { id: "user-mixed", role: "user", text: "inspect", createdAt: 1, turnId: "turn-mixed" },
    {
      id: "assistant-mixed",
      role: "assistant",
      text: "",
      createdAt: 2,
      turnId: "turn-mixed",
      assistantParts: [
        {
          type: "tool",
          id: "cmd-mixed-1",
          toolCall: {
            id: "cmd-mixed-1",
            type: "commandExecution",
            command: "Get-Content package.json",
            status: "completed"
          }
        },
        {
          type: "subagent",
          id: "subagent-mixed-1",
          subagent: {
            id: "subagent-mixed-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            status: "completed",
            senderThreadId: "thread-mixed-calls",
            receiverThreadIds: ["thread-child"],
            prompt: "只读探索项目结构",
            agentsStates: {
              "thread-child": { status: "completed", message: "Fermat" }
            },
            details: {
              id: "subagent-mixed-1",
              type: "collabAgentToolCall",
              tool: "spawnAgent"
            }
          }
        },
        {
          type: "tool",
          id: "cmd-mixed-2",
          toolCall: {
            id: "cmd-mixed-2",
            type: "commandExecution",
            command: "Get-ChildItem src",
            status: "completed"
          }
        }
      ]
    }
  ]
};

const childSubagentThread: UiThread = {
  id: "thread-child",
  cwd: "D:\\repo",
  title: "Fermat",
  updatedAt: Date.now(),
  isDraft: false,
  parentThreadId: "thread-subagent",
  threadSource: "subagent",
  isSubagent: true,
  messages: []
};

const activeGoal: ThreadGoal = {
  threadId: "thread-1",
  objective: "构建目标面板",
  status: "active",
  tokenBudget: null,
  tokensUsed: 1200,
  timeUsedSeconds: 30,
  createdAt: 1,
  updatedAt: 2
};
