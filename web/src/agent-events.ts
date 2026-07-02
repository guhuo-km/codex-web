import { readPath } from "./codex-normalizers.js";
import type { UiAgentEvent, UiAgentEventKind } from "./types.js";

export interface AgentEventSource {
  type: string;
  seq?: number;
  createdAt?: string;
  payload?: unknown;
}

export function agentEventPartId(source: AgentEventSource, fallbackIndex = 0): string {
  return source.seq != null ? `agent-event-${source.seq}` : `agent-event-${fallbackIndex}-${Date.parse(source.createdAt ?? "") || Date.now()}`;
}

export function eventToAgentEvent(event: AgentEventSource, fallbackTitle?: string): UiAgentEvent {
  const payload = event.payload as Record<string, unknown> | undefined;
  const payloadKind = typeof payload?.kind === "string" ? payload.kind : undefined;
  const kind = normalizeAgentEventKind(payloadKind, readPath<string>(event, ["payload", "status"]), event.type, payload);
  const title = fallbackTitle
    ?? (firstString(
      readPath<string>(event, ["payload", "message"]),
      readPath<string>(event, ["payload", "title"]),
      readPath<string>(event, ["payload", "error", "message"]),
      readPath<string>(event, ["payload", "error", "detail"]),
      readPath<string>(event, ["payload", "params", "message"]),
      readPath<string>(event, ["payload", "params", "title"]),
      readPath<string>(event, ["payload", "params", "reason"]),
      readPath<string>(event, ["payload", "params", "item", "message"]),
      readPath<string>(event, ["payload", "params", "item", "title"]),
      readPath<string>(event, ["payload", "params", "error", "message"]),
      readPath<string>(event, ["payload", "params", "error", "detail"]),
      titleFromEventType(event.type)
    )
    || event.type);
  const message = firstString(
    readPath<string>(event, ["payload", "detail"]),
    readPath<string>(event, ["payload", "description"]),
    readPath<string>(event, ["payload", "additionalDetails"]),
    readPath<string>(event, ["payload", "params", "detail"]),
    readPath<string>(event, ["payload", "params", "details"]),
    readPath<string>(event, ["payload", "params", "description"]),
    readPath<string>(event, ["payload", "params", "additionalDetails"]),
    readPath<string>(event, ["payload", "params", "item", "detail"]),
    readPath<string>(event, ["payload", "params", "item", "details"]),
    readPath<string>(event, ["payload", "params", "item", "description"]),
    readPath<string>(event, ["payload", "params", "item", "additionalDetails"]),
    readPath<string>(event, ["payload", "params", "error", "additionalDetails"])
  ) || undefined;
  return {
    kind,
    title,
    message,
    tone: toneForAgentEvent(kind),
    details: event.payload,
    createdAt: Date.parse(event.createdAt ?? "") || undefined,
    eventType: event.type
  };
}

function normalizeAgentEventKind(kind: string | undefined, status: string | undefined, eventType: string, payload?: Record<string, unknown>): UiAgentEventKind {
  if (kind === "error" || kind === "warning" || kind === "status") return kind;
  if (kind === "retry") return "warning";
  if (eventType === "codex.error") {
    if (readPath<boolean>(payload, ["willRetry"]) || readPath<boolean>(payload, ["params", "willRetry"])) return "warning";
    return "error";
  }
  if (eventType.startsWith("codex.request.") || eventType === "codex.serverRequest/resolved") return "status";
  if (eventType.startsWith("codex.model/")) return "status";
  if (eventType === "codex.warning" || eventType === "codex.guardianWarning" || eventType === "codex.configWarning") return "warning";
  if (eventType === "codex.deprecationNotice") return "status";
  if (eventType === "codex.thread/realtime/error") return "error";
  if (eventType === "codex.mcpServer/startupStatus/updated" && (readPath<string>(payload, ["error"]) || readPath<string>(payload, ["params", "error"]))) return "warning";
  if (status === "failed" || status === "interrupted") return "error";
  if (eventType.includes("error") || eventType.includes("failed")) return "error";
  return "status";
}

export function isAgentEventSourceEvent(event: AgentEventSource): boolean {
  if (event.type === "codex.error") return true;
  if (event.type.startsWith("codex.request.")) return true;
  if (event.type === "codex.serverRequest/resolved") return true;
  if (event.type === "codex.warning") return true;
  if (event.type === "codex.guardianWarning") return true;
  if (event.type === "codex.configWarning") return true;
  if (event.type === "codex.deprecationNotice") return true;
  if (event.type === "codex.thread/realtime/error") return true;
  if (event.type.startsWith("codex.model/")) return true;
  if (event.type === "codex.mcpServer/startupStatus/updated") {
    return Boolean(readPath<string>(event, ["payload", "params", "error"]) || readPath<string>(event, ["payload", "error"]));
  }
  return false;
}

export function isGenericTurnAgentEventSourceEvent(event: AgentEventSource): boolean {
  if (!event.type.startsWith("codex.")) return false;
  if (isAgentEventSourceEvent(event)) return false;
  if (event.type === "codex.agent/status") return false;
  if (event.type === "codex.turn/started" || event.type === "codex.turn/completed") return false;
  if (event.type.startsWith("codex.item/")) return false;
  if (event.type.startsWith("codex.rawResponseItem/")) return false;
  if (event.type === "codex.thread/tokenUsage/updated") return false;
  if (event.type === "codex.thread/status/changed") return false;
  if (event.type === "codex.turn/diff/updated") return false;
  if (event.type === "codex.thread/goal/updated") return false;
  if (event.type === "codex.thread/goal/cleared") return false;
  if (event.type === "codex.mcpServer/startupStatus/updated") return false;
  if (event.type === "codex.thread/name/updated") return false;
  if (event.type === "codex.thread/settings/updated") return false;
  if (event.type === "codex.thread/compacted") return false;
  return true;
}

export function isUnknownCodexItemEvent(event: AgentEventSource): boolean {
  if (event.type !== "codex.item/started" && event.type !== "codex.item/completed") return false;
  const itemType = readPath<string>(event, ["payload", "params", "item", "type"]);
  if (!itemType) return false;
  return ![
    "agentMessage",
    "userMessage",
    "reasoning",
    "contextCompaction",
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "webSearch",
    "imageView",
    "imageGeneration",
    "collabAgentToolCall",
    "subAgentActivity"
  ].includes(itemType);
}

export function isUnknownRawResponseItemEvent(event: AgentEventSource): boolean {
  if (event.type !== "codex.rawResponseItem/started" && event.type !== "codex.rawResponseItem/completed") return false;
  const itemType = readPath<string>(event, ["payload", "params", "item", "type"]);
  if (!itemType) return false;
  return ![
    "custom_tool_call",
    "function_call",
    "image_generation_call",
    "web_search_call",
    "custom_tool_call_output",
    "function_call_output"
  ].includes(itemType);
}

function toneForAgentEvent(kind: UiAgentEventKind): UiAgentEvent["tone"] {
  if (kind === "error") return "danger";
  if (kind === "warning") return "warning";
  return "muted";
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function titleFromEventType(eventType: string): string | undefined {
  if (eventType === "codex.model/rerouted") return "模型已切换";
  if (eventType.startsWith("codex.request.")) return "需要用户批准";
  if (eventType === "codex.serverRequest/resolved") return "用户批准已处理";
  if (eventType === "codex.model/verification") return "模型校验";
  if (eventType === "codex.model/safetyBuffering/updated") return "模型安全缓冲";
  if (eventType === "codex.warning") return "警告";
  if (eventType === "codex.configWarning") return "配置警告";
  if (eventType === "codex.guardianWarning") return "安全警告";
  if (eventType === "codex.deprecationNotice") return "弃用提醒";
  if (eventType === "codex.thread/realtime/error") return "实时连接错误";
  if (eventType === "codex.mcpServer/startupStatus/updated") return "MCP 服务启动错误";
  return undefined;
}
