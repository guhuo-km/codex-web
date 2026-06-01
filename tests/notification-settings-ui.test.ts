import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { DEFAULT_CUSTOM_BODY_TEMPLATE, NotificationSettingsPanel } from "../web/src/components/NotificationSettingsPanel.js";

describe("NotificationSettingsPanel", () => {
  test("renders notification subtabs", () => {
    const html = renderToStaticMarkup(React.createElement(NotificationSettingsPanel));

    expect(html).toContain("渠道");
    expect(html).toContain("自定义");
    expect(html).toContain("记录");
  });

  test("defaults custom webhook body to native notification fields", () => {
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{title}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{message}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{threadId}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{turnId}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{durationMs}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{errorMessage}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{tokenUsage.totalTokens}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{tokenUsage.inputTokens}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{tokenUsage.outputTokens}}");
    expect(DEFAULT_CUSTOM_BODY_TEMPLATE).toContain("{{source}}");
  });
});
