export type NotificationStatus = "completed" | "failed" | "interrupted";
export type CustomBodyFormat = "text" | "json";

export interface TokenUsageSummary {
  totalTokens?: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
}

export interface CompletionNotification {
  type: "turn.completed" | "turn.failed" | "turn.interrupted";
  status: NotificationStatus;
  title: string;
  message: string;
  threadId: string;
  turnId: string;
  source: string;
  startedAt?: number | null;
  completedAt?: number | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  tokenUsage?: TokenUsageSummary | null;
}

export type TemplateVariables = Record<string, unknown>;

export function renderTextTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => stringifyTemplateValue(readTemplateValue(variables, token)));
}

export function renderCustomBodyTemplate(template: string, variables: TemplateVariables, format: CustomBodyFormat): string {
  if (format === "json") {
    return template.replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => escapeJsonTemplateValue(readTemplateValue(variables, token)));
  }
  return renderTextTemplate(template, variables);
}

function readTemplateValue(variables: TemplateVariables, token: string): unknown {
  const path = token.split(".").map((part) => part.trim()).filter(Boolean);
  let current: unknown = variables;
  for (const part of path) {
    if (current == null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? "";
}

function stringifyTemplateValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function escapeJsonTemplateValue(value: unknown): string {
  return JSON.stringify(stringifyTemplateValue(value)).slice(1, -1);
}
