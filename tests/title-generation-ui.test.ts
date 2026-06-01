import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TitleGenerationSettingsPanel } from "../web/src/components/TitleGenerationSettingsPanel.js";

describe("TitleGenerationSettingsPanel", () => {
  test("renders the OpenAI-compatible title generation controls", () => {
    const html = renderToStaticMarkup(React.createElement(TitleGenerationSettingsPanel));

    expect(html).toContain("标题生成");
    expect(html).toContain("API URL");
    expect(html).toContain("API Key");
    expect(html).toContain("模型");
    expect(html).toContain("保存配置");
  });
});
