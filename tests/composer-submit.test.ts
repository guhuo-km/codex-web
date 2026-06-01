import { describe, expect, test, vi } from "vitest";
import { submitComposerMessage } from "../web/src/components/composer-submit.js";
import type { UploadedAttachment } from "../web/src/types.js";

describe("submitComposerMessage", () => {
  test("clears the draft only after send resolves", async () => {
    let resolveSend: (() => void) | undefined;
    const sendPromise = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const calls: string[] = [];
    const attachments: UploadedAttachment[] = [{
      id: "image-1",
      kind: "image",
      name: "a.png",
      mimeType: "image/png",
      url: "/uploads/a.png",
      input: { type: "input_image", image_url: "/uploads/a.png" }
    }];

    const result = submitComposerMessage({
      text: " hello ",
      attachments,
      onSend: vi.fn(() => {
        calls.push("send");
        return sendPromise;
      }),
      onTextChange: () => calls.push("clear-text"),
      onAttachmentsChange: () => calls.push("clear-attachments"),
      onError: () => calls.push("error")
    });

    await Promise.resolve();
    expect(calls).toEqual(["send"]);

    resolveSend?.();
    await expect(result).resolves.toBe(true);
    expect(calls).toEqual(["send", "clear-text", "clear-attachments"]);
  });

  test("keeps the draft when send rejects", async () => {
    const calls: string[] = [];

    await expect(submitComposerMessage({
      text: " hello ",
      attachments: [],
      onSend: vi.fn(async () => {
        calls.push("send");
        throw new Error("network down");
      }),
      onTextChange: () => calls.push("clear-text"),
      onAttachmentsChange: () => calls.push("clear-attachments"),
      onError: () => calls.push("error")
    })).resolves.toBe(false);

    expect(calls).toEqual(["send", "error"]);
  });
});
