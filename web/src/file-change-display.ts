import type { UiFileChange, UiToolCall } from "./types.js";

export interface FileChangeView {
  change: UiFileChange;
  label: string;
  path: string;
  stats: DiffStats;
  code: string;
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function fileChangeViews(toolCall: UiToolCall): FileChangeView[] {
  return (toolCall.changes ?? []).map((change) => ({
    change,
    label: fileChangeKindLabel(change),
    path: change.movePath ? `${change.path} -> ${change.movePath}` : change.path,
    stats: diffStatsForFileChange(change),
    code: fileChangeDiffCode(change)
  }));
}

export function diffStatsForToolCall(toolCall: UiToolCall): DiffStats {
  return sumDiffStats(fileChangeViews(toolCall).map((view) => view.stats));
}

export function diffStatsForFileChange(change: UiFileChange): DiffStats {
  if (!change.diff) return { added: 0, removed: 0 };
  if (change.kind === "add" && !looksLikePatch(change.diff)) {
    return { added: countContentLines(change.diff), removed: 0 };
  }
  if (change.kind === "delete" && !looksLikePatch(change.diff)) {
    return { added: 0, removed: countContentLines(change.diff) };
  }
  return countPatchLines(change.diff);
}

export function fileChangeKindLabel(change: UiFileChange): string {
  if (change.kind === "add") return "新增";
  if (change.kind === "delete") return "删除";
  if (change.kind === "update") return "更新";
  if (change.kind === "move") return "移动";
  return "变更";
}

export function fileChangeDiffCode(change: UiFileChange): string {
  const diff = change.diff ?? "";
  if (change.kind === "add" && diff && !looksLikePatch(diff)) {
    return contentLines(diff).map((line) => line ? `+${line}` : "+").join("\n");
  }
  if (change.kind === "delete" && diff && !looksLikePatch(diff)) {
    return contentLines(diff).map((line) => line ? `-${line}` : "-").join("\n");
  }
  return diff;
}

export function countPatchLines(diff: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function looksLikePatch(diff: string): boolean {
  return /^@@\s+-\d+/m.test(diff) || /^(?:---|\+\+\+) /m.test(diff);
}

function countContentLines(text: string): number {
  return contentLines(text).length;
}

function contentLines(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return withoutTrailingNewline ? withoutTrailingNewline.split("\n") : [];
}

function sumDiffStats(stats: DiffStats[]): DiffStats {
  return stats.reduce((total, item) => ({
    added: total.added + item.added,
    removed: total.removed + item.removed
  }), { added: 0, removed: 0 });
}
