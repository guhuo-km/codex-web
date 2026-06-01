import { describe, expect, test } from "vitest";
import { clipboardImageFiles } from "../web/src/components/composer-clipboard.js";

describe("clipboardImageFiles", () => {
  test("returns only image files from clipboard items", () => {
    const png = new File(["png"], "screenshot.png", { type: "image/png" });
    const textFile = new File(["text"], "notes.txt", { type: "text/plain" });
    const items = [
      clipboardFileItem(png),
      clipboardFileItem(textFile),
      { kind: "string", type: "text/plain", getAsFile: () => null }
    ];

    expect(clipboardImageFiles(items)).toEqual([png]);
  });

  test("uses a generated name when pasted image file has no name", () => {
    const image = new File(["png"], "", { type: "image/png" });

    expect(clipboardImageFiles([clipboardFileItem(image)])[0]?.name).toMatch(/^pasted-image-\d+\.png$/);
  });
});

function clipboardFileItem(file: File) {
  return {
    kind: "file",
    type: file.type,
    getAsFile: () => file
  };
}
