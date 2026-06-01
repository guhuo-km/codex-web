import { describe, expect, test } from "vitest";
import { renderCustomBodyTemplate, renderTextTemplate } from "../src/notifications/notification-types.js";

describe("notification custom templates", () => {
  test("escapes interpolated values inside JSON body templates", () => {
    const rendered = renderCustomBodyTemplate(
      '{"title":"{{title}}","message":"{{message}}","duration":"{{durationMs}}"}',
      {
        title: "Codex task completed",
        message: "line 1 \"quoted\"\\path\nline 2",
        durationMs: 1234
      },
      "json"
    );

    expect(rendered).toBe(
      '{"title":"Codex task completed","message":"line 1 \\"quoted\\"\\\\path\\nline 2","duration":"1234"}'
    );
    expect(JSON.parse(rendered)).toEqual({
      title: "Codex task completed",
      message: "line 1 \"quoted\"\\path\nline 2",
      duration: "1234"
    });
  });

  test("uses raw text interpolation for non-json body templates", () => {
    const rendered = renderCustomBodyTemplate(
      "title={{title}}\nmessage={{message}}",
      { title: "Done", message: "hello \"world\"" },
      "text"
    );

    expect(rendered).toBe("title=Done\nmessage=hello \"world\"");
  });

  test("renders missing template variables as empty strings", () => {
    expect(renderTextTemplate("{{title}} {{unknown}}", { title: "Done" })).toBe("Done ");
  });
});
