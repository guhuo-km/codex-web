import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Composer } from "../web/src/components/Composer.js";
import { composerUsesLocalDraftText } from "../web/src/components/Composer.js";

describe("Composer", () => {
  test("keeps typing local to the composer instead of updating App on every key", () => {
    expect(composerUsesLocalDraftText).toBe(true);
  });

  test("renders an expand button for the message input", () => {
    const html = renderToStaticMarkup(React.createElement(Composer, {
      disabled: false,
      isDraft: false,
      workMode: "default",
      model: "gpt-5.5",
      effort: "medium",
      text: "hello",
      attachments: [],
      commandMode: null,
      sendBehavior: "enter",
      onTextChange: () => {},
      onAttachmentsChange: () => {},
      onCommandModeChange: () => {},
      onRunCompact: () => {},
      onRunInit: () => {},
      onSelectProject: () => {},
      onSelectWorkMode: () => {},
      onSelectModel: () => {},
      onSelectEffort: () => {},
      onSend: () => {},
      capabilities: null,
      onToggleSkill: () => {},
      onTogglePlugin: () => {}
    }));

    expect(html).toContain("展开输入框");
    expect(html).toContain("aria-expanded=\"false\"");
  });

  test("shows active goal status near the input and omits the goal slash command", () => {
    const html = renderToStaticMarkup(React.createElement(Composer, {
      disabled: false,
      isDraft: false,
      workMode: "default",
      model: "gpt-5.5",
      effort: "medium",
      text: "/",
      attachments: [],
      commandMode: null,
      sendBehavior: "enter",
      goal: {
        threadId: "thread-1",
        objective: "完善目标模式",
        status: "active",
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0,
        createdAt: 1,
        updatedAt: 1
      },
      onTextChange: () => {},
      onAttachmentsChange: () => {},
      onCommandModeChange: () => {},
      onRunCompact: () => {},
      onRunInit: () => {},
      onSelectProject: () => {},
      onSelectWorkMode: () => {},
      onSelectModel: () => {},
      onSelectEffort: () => {},
      onSend: () => {},
      capabilities: null,
      onToggleSkill: () => {},
      onTogglePlugin: () => {}
    }));

    expect(html).toContain("目标进行中");
    expect(html).toContain("composer-goal-status active");
    expect(html).not.toContain("/goal");
  });

  test("renders pending steer messages above the input with a cancel action only while queued", () => {
    const html = renderToStaticMarkup(React.createElement(Composer, {
      disabled: false,
      isDraft: false,
      workMode: "default",
      model: "gpt-5.5",
      effort: "medium",
      text: "",
      attachments: [],
      commandMode: null,
      sendBehavior: "enter",
      pendingSteers: [
        { id: "steer-queued", text: "修正错字", status: "queued" },
        { id: "steer-submitted", text: "已经提交", status: "submitted" }
      ],
      onRemovePendingSteer: () => {},
      onTextChange: () => {},
      onAttachmentsChange: () => {},
      onCommandModeChange: () => {},
      onRunCompact: () => {},
      onRunInit: () => {},
      onSelectProject: () => {},
      onSelectWorkMode: () => {},
      onSelectModel: () => {},
      onSelectEffort: () => {},
      onSend: () => {},
      capabilities: null,
      onToggleSkill: () => {},
      onTogglePlugin: () => {}
    }));

    expect(html).toContain("composer-steer-queue");
    expect(html).toContain("修正错字");
    expect(html).toContain("待发送");
    expect(html).toContain("已经提交");
    expect(html).toContain("已提交，等待追加");
    expect(html).toContain("aria-label=\"取消引导消息\"");
  });
});
