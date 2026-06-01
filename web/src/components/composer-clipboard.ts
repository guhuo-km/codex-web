export interface ClipboardImageItem {
  kind: string;
  type: string;
  getAsFile: () => File | null;
}

export function clipboardImageFiles(items: ArrayLike<ClipboardImageItem>): File[] {
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(file.name ? file : createPastedImageFile(file));
  }
  return files;
}

function createPastedImageFile(file: File): File {
  const extension = extensionForMimeType(file.type);
  const name = `pasted-image-${Date.now()}.${extension}`;
  return new File([file], name, {
    type: file.type,
    lastModified: file.lastModified
  });
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/bmp") return "bmp";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
}
