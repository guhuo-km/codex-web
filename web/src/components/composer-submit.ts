import type { UploadedAttachment } from "../types";

export async function submitComposerMessage(input: {
  text: string;
  attachments: UploadedAttachment[];
  onSend: (text: string, attachments: UploadedAttachment[]) => void | Promise<void>;
  onTextChange: (text: string) => void;
  onAttachmentsChange: (attachments: UploadedAttachment[]) => void;
  onError: (error: unknown) => void;
}): Promise<boolean> {
  try {
    await input.onSend(input.text.trim(), input.attachments);
    input.onTextChange("");
    input.onAttachmentsChange([]);
    return true;
  } catch (error) {
    input.onError(error);
    return false;
  }
}
