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
});
