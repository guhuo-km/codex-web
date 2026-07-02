import type { UiMessage, UiToolCall } from "./types.js";

export interface CodexEventLike {
  type?: string;
  threadId?: string;
  turnId?: string;
  payload?: unknown;
}

export function readPath<T>(input: unknown, path: string[]): T | undefined {
  let current: any = input;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current as T | undefined;
}

export function normalizeTurnStartedAt(event: CodexEventLike, fallback = Date.now()): number {
  const numericStartedAt = normalizeTimestampMs(
    readPath<number>(event, ["payload", "params", "turn", "startedAt"]) ??
    readPath<number>(event, ["payload", "startedAt"])
  );
  const stringStartedAt = Date.parse(String(readPath<string>(event, ["payload", "startedAt"]) ?? "")) || undefined;
  return numericStartedAt ?? stringStartedAt ?? fallback;
}

export function normalizeTurnTiming(event: CodexEventLike, fallbackCompletedAt = Date.now()): { turnId?: string; startedAt?: number; completedAt?: number; durationMs?: number } {
  const turnId = event.turnId ?? readPath<string>(event, ["payload", "turnId"]) ?? readPath<string>(event, ["payload", "params", "turn", "id"]);
  const startedAt = normalizeTimestampMs(readPath<number>(event, ["payload", "params", "turn", "startedAt"])) ??
    (Date.parse(String(readPath<string>(event, ["payload", "startedAt"]) ?? "")) || undefined);
  const completedAt = normalizeTimestampMs(readPath<number>(event, ["payload", "params", "turn", "completedAt"])) ??
    (Date.parse(String(readPath<string>(event, ["payload", "completedAt"]) ?? "")) || fallbackCompletedAt);
  const durationMs = readPath<number>(event, ["payload", "params", "turn", "durationMs"]) ??
    durationFromTiming(startedAt, completedAt);
  return { turnId, startedAt, completedAt, durationMs };
}

export function normalizeTokenUsage(event: CodexEventLike): UiMessage["tokenUsage"] | undefined {
  const last = readPath<Record<string, unknown>>(event, ["payload", "params", "tokenUsage", "last"]);
  if (!last) return undefined;
  return {
    inputTokens: numberValue(last.inputTokens),
    cachedInputTokens: numberValue(last.cachedInputTokens),
    outputTokens: numberValue(last.outputTokens),
    totalTokens: numberValue(last.totalTokens)
  };
}

export function isCodexToolItem(item: Record<string, unknown> | undefined): item is Record<string, unknown> {
  return Boolean(item && [
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "webSearch",
    "imageView",
    "imageGeneration"
  ].includes(String(item.type)));
}

export function isContextCompactionItem(item: Record<string, unknown> | undefined): boolean {
  return Boolean(item && String(item.type) === "contextCompaction");
}

export function normalizeReasoningItem(item: Record<string, unknown> | undefined): { id: string; text: string; summary?: boolean } | null {
  if (!item || String(item.type) !== "reasoning") return null;
  const text = firstString(
    item.text,
    item.summary,
    item.content,
    Array.isArray(item.summaryText) ? item.summaryText.join("\n") : undefined
  );
  if (!text) return null;
  return {
    id: String(item.id ?? "reasoning"),
    text,
    summary: true
  };
}

export function normalizeContextCompactionMarker(input: { id: string; createdAt?: number; turnId?: string }): { id: string; role: "system"; text: string; createdAt?: number; turnId?: string; systemMarker: "contextCompaction" } {
  return {
    id: input.id,
    role: "system",
    text: "上下文已压缩",
    createdAt: input.createdAt,
    turnId: input.turnId,
    systemMarker: "contextCompaction"
  };
}

export function normalizeToolCallFromItem(item: Record<string, unknown>): UiToolCall {
  const type = String(item.type ?? "tool");
  const tool = typeof item.tool === "string" ? item.tool : undefined;
  const server = typeof item.server === "string" ? item.server : undefined;
  const query = typeof item.query === "string" ? item.query : undefined;
  const path = typeof item.path === "string" ? item.path : undefined;
  const command = type === "commandExecution" ? String(item.command ?? "") : "";
  return {
    id: String(item.id ?? item.command ?? `${type}:${tool ?? server ?? query ?? path ?? "unknown"}`),
    type,
    command,
    title: toolCallTitleFromItem(type, item, { tool, server, query, path }),
    toolName: tool,
    server,
    arguments: item.arguments,
    result: item.result ?? item.contentItems ?? item.savedPath ?? undefined,
    error: item.error,
    changes: readFileChanges(item.changes),
    cwd: typeof item.cwd === "string" ? item.cwd : undefined,
    status: typeof item.status === "string" ? item.status : undefined,
    aggregatedOutput: typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : null,
    exitCode: typeof item.exitCode === "number" ? item.exitCode : null,
    durationMs: typeof item.durationMs === "number" ? item.durationMs : null,
    commandExplanation: typeof item.commandExplanation === "string" ? item.commandExplanation : undefined
  };
}

export function normalizeRawResponseToolCall(item: Record<string, unknown> | undefined): UiToolCall | null {
  const rawType = String(item?.type ?? "");
  if (!item || (rawType !== "custom_tool_call" && rawType !== "function_call" && rawType !== "image_generation_call" && rawType !== "web_search_call")) return null;
  const name = typeof item.name === "string" ? item.name : rawType;
  const id = String(item.call_id ?? item.id ?? `raw-${rawType}`);
  if (rawType === "image_generation_call") {
    return {
      id,
      type: "imageGeneration",
      command: "",
      title: "生成图片",
      toolName: name,
      result: item.result,
      status: normalizeRawToolStatus(item.status)
    };
  }
  if (rawType === "web_search_call") {
    return {
      id,
      type: "webSearch",
      command: "",
      title: "网络搜索",
      toolName: name,
      arguments: item.action,
      status: normalizeRawToolStatus(item.status)
    };
  }
  if (!isImageViewToolName(name)) return null;
  const rawInput = item.input ?? item.arguments;
  const parsedInput = parseMaybeJson(rawInput);
  const imagePath = readRawImagePath(parsedInput) ?? readRawImagePath(rawInput);
  return {
    id,
    type: "imageView",
    command: "",
    title: imagePath ? `查看图片 · ${pathBasename(imagePath)}` : "查看图片",
    toolName: name,
    arguments: parsedInput ?? rawInput,
    result: imagePath,
    status: normalizeRawToolStatus(item.status)
  };
}

export function normalizeRawResponseToolOutput(item: Record<string, unknown> | undefined): { id: string; output: unknown } | null {
  const rawType = String(item?.type ?? "");
  if (!item || (rawType !== "custom_tool_call_output" && rawType !== "function_call_output")) return null;
  const id = typeof item.call_id === "string" ? item.call_id : "";
  if (!id) return null;
  return { id, output: item.output };
}

export function durationFromTiming(startedAt?: number | null, completedAt?: number | null): number | undefined {
  if (!startedAt || !completedAt || completedAt < startedAt) return undefined;
  return completedAt - startedAt;
}

export function formatJsonValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function pathBasename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function toolCallTitleFromItem(
  type: string,
  item: Record<string, unknown>,
  input: { tool?: string; server?: string; query?: string; path?: string }
): string {
  if (type === "commandExecution") return String(item.command ?? "");
  if (type === "fileChange") return fileChangeTitle(item);
  if (type === "mcpToolCall") return [input.server, input.tool].filter(Boolean).join(" / ") || "MCP 工具";
  if (type === "dynamicToolCall") return input.tool || "自定义工具";
  if (type === "webSearch") return input.query || "网络搜索";
  if (type === "imageView") return input.path || "查看图片";
  if (type === "imageGeneration") return "生成图片";
  return type;
}

function readFileChanges(value: unknown): UiToolCall["changes"] {
  if (!Array.isArray(value)) return undefined;
  return value.map((change: any) => ({
    path: String(change?.path ?? ""),
    kind: typeof change?.kind?.type === "string" ? change.kind.type : typeof change?.kind === "string" ? change.kind : undefined,
    movePath: typeof change?.kind?.move_path === "string" ? change.kind.move_path : null,
    diff: typeof change?.diff === "string" ? change.diff : undefined
  })).filter((change) => change.path);
}

function fileChangeTitle(item: Record<string, unknown>): string {
  const changes = readFileChanges(item.changes);
  if (!changes?.length) return "修改文件";
  const first = pathBasename(changes[0].path);
  return changes.length === 1 ? `修改文件 · ${first}` : `修改文件 · ${first} 等 ${changes.length} 个文件`;
}

function isImageViewToolName(name: string): boolean {
  return /(^|[._-])view[_-]?image$|(^|[._-])image[_-]?view$|查看图片/i.test(name);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readRawImagePath(value: unknown): string | undefined {
  if (typeof value === "string") {
    const match = /[A-Za-z]:[\\/][^\r\n"'<>]+?\.(?:png|jpe?g|webp|gif|bmp|svg)/i.exec(value);
    return match?.[0]?.trim();
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return firstString(record.path, record.filePath, record.imagePath, record.localPath);
}

function normalizeRawToolStatus(status: unknown): UiToolCall["status"] {
  if (status === "completed" || status === "failed" || status === "cancelled") return status;
  return "inProgress";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeTimestampMs(input: unknown): number | undefined {
  if (typeof input !== "number" || !Number.isFinite(input)) return undefined;
  return input < 10_000_000_000 ? input * 1000 : input;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}
