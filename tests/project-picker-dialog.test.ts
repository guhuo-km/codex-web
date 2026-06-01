import { describe, expect, test } from "vitest";
import { buildBreadcrumbs } from "../web/src/components/ProjectPickerDialog.js";

describe("buildBreadcrumbs", () => {
  test("keeps Linux paths intact", () => {
    expect(buildBreadcrumbs("/home/kmg32/codex")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "kmg32", path: "/home/kmg32" },
      { label: "codex", path: "/home/kmg32/codex" }
    ]);
  });

  test("keeps Windows paths intact", () => {
    expect(buildBreadcrumbs("D:\\codex-web\\project")).toEqual([
      { label: "D:", path: "D:\\" },
      { label: "codex-web", path: "D:\\codex-web" },
      { label: "project", path: "D:\\codex-web\\project" }
    ]);
  });
});
