import type { TitleGenerationSettings, TitleGenerationStore } from "./title-generation-store.js";
import { AppError } from "../errors.js";

export interface TitleGenerationServiceOptions {
  fetchFn?: typeof fetch;
}

export interface GenerateTitleInput {
  thread: unknown;
}

export interface ExplainCommandInput {
  command: string;
}

export class TitleGenerationService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly store: TitleGenerationStore,
    options: TitleGenerationServiceOptions = {}
  ) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async readPublicSettings() {
    return this.store.readPublic();
  }

  async updateSettings(patch: Partial<TitleGenerationSettings>) {
    await this.store.write(patch);
    return this.store.readPublic();
  }

  async generateTitle(input: GenerateTitleInput): Promise<string> {
    const settings = await this.store.read();
    return this.generateTitleWithSettings(input.thread, settings);
  }

  async explainCommand(input: ExplainCommandInput): Promise<string> {
    const settings = await this.store.read();
    return this.explainCommandWithSettings(input.command, settings);
  }

  async generateTitleWithSettings(thread: unknown, settings: TitleGenerationSettings): Promise<string> {
    if (!settings.enabled) throw new AppError("Title generation is disabled", "TITLE_GENERATION_DISABLED", 400);
    if (!settings.apiKey) throw new AppError("Title generation API key is missing", "TITLE_GENERATION_KEY_MISSING", 400);
    if (!settings.model.trim()) throw new AppError("Title generation model is missing", "TITLE_GENERATION_MODEL_MISSING", 400);

    const context = buildConversationContext(thread);
    if (!context) throw new AppError("No thread content available for title generation", "TITLE_GENERATION_EMPTY_THREAD", 400);

    const url = normalizeChatCompletionsUrl(settings.apiBaseUrl);
    const controller = AbortSignal.timeout(settings.timeoutMs);
    const response = await this.fetchFn(url, {
      method: "POST",
      signal: controller,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        max_tokens: 48,
        messages: [
          {
            role: "system",
            content: "You write short conversation titles. Return only the title text. No markdown, no quotes, no bullets, no explanation."
          },
          {
            role: "user",
            content: [
              "Generate a concise title for this conversation.",
              "Return a single line only.",
              "",
              context
            ].join("\n")
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError(
        `Title generation request failed with status ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
        "TITLE_GENERATION_REQUEST_FAILED",
        502
      );
    }

    const payload = await response.json().catch(() => null);
    const raw = extractResponseText(payload);
    const title = cleanTitle(raw);
    if (!title) throw new AppError("Title generation returned an empty title", "TITLE_GENERATION_EMPTY_RESULT", 502);
    return title;
  }

  async explainCommandWithSettings(command: string, settings: TitleGenerationSettings): Promise<string> {
    if (!settings.enabled) throw new AppError("AI assist is disabled", "AI_ASSIST_DISABLED", 400);
    if (!settings.apiKey) throw new AppError("AI assist API key is missing", "AI_ASSIST_KEY_MISSING", 400);
    if (!settings.model.trim()) throw new AppError("AI assist model is missing", "AI_ASSIST_MODEL_MISSING", 400);

    const normalizedCommand = command.trim();
    if (!normalizedCommand) throw new AppError("Command is required", "AI_ASSIST_EMPTY_COMMAND", 400);

    const url = normalizeChatCompletionsUrl(settings.apiBaseUrl);
    const controller = AbortSignal.timeout(settings.timeoutMs);
    const response = await this.fetchFn(url, {
      method: "POST",
      signal: controller,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.1,
        max_tokens: 96,
        messages: [
          {
            role: "system",
            content: [
              "你解释 shell、PowerShell、bash 等命令的实际行为。",
              "只解释真正执行的核心动作，会读取、列出、写入、启动或删除什么。",
              "如果命令通过 pwsh、powershell、bash、cmd 等外层 shell 启动器包了一层，忽略外层 shell 启动器，不要说“启动 PowerShell”。",
              "不要推测 Agent 的意图，不要结合未知上下文，不要做安全或风险结论。",
              "别废话。用中文输出一条短句，最多 45 个汉字。不要 Markdown，不要项目符号，不要加标题。"
            ].join("\n")
          },
          {
            role: "user",
            content: `命令：\n${truncateText(normalizedCommand, 4000)}`
          }
        ]
      })
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new AppError(
        `AI assist request failed with status ${response.status}${body ? `: ${body.slice(0, 240)}` : ""}`,
        "AI_ASSIST_REQUEST_FAILED",
        502
      );
    }

    const payload = await response.json().catch(() => null);
    const explanation = cleanCommandExplanation(extractResponseText(payload));
    if (!explanation) throw new AppError("AI assist returned an empty explanation", "AI_ASSIST_EMPTY_RESULT", 502);
    return explanation;
  }
}

function normalizeChatCompletionsUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new AppError("Title generation API URL is missing", "TITLE_GENERATION_URL_MISSING", 400);
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

function extractResponseText(payload: any): string {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && typeof part.text === "string") return part.text;
      return "";
    }).join("");
  }
  if (typeof payload?.title === "string") return payload.title;
  if (typeof payload?.text === "string") return payload.text;
  return "";
}

function cleanTitle(input: string): string {
  const normalized = input
    .replace(/^\s*[\s`"'“”‘’]+/, "")
    .replace(/[\s`"'“”‘’]+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 40 ? normalized.slice(0, 40).trim() : normalized;
}

function cleanCommandExplanation(input: string): string {
  const normalized = input
    .replace(/^\s*[-*•\d.)\s`"'“”‘’]+/, "")
    .replace(/[\s`"'“”‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  return normalized.length > 120 ? normalized.slice(0, 120).trim() : normalized;
}

function buildConversationContext(thread: unknown): string {
  const messages = collectMessages(thread).slice(-12);
  if (!messages.length) return "";
  return messages.map((message, index) => {
    const roleLabel = message.role === "assistant" ? "AI" : "User";
    const text = truncateText(message.text, 500);
    const prefix = `${index + 1}. ${roleLabel}: `;
    return `${prefix}${text}`;
  }).join("\n");
}

function collectMessages(input: unknown): Array<{ role: "user" | "assistant"; text: string }> {
  const root = input as any;
  const turns = [...asArray(root?.thread?.turns), ...asArray(root?.turns)];
  const messages: Array<{ role: "user" | "assistant"; text: string }> = [];

  for (const turn of turns) {
    const turnRecord = turn as any;
    const items = asArray(turnRecord?.items);
    for (const item of items) {
      const itemRecord = item as any;
      const candidate = itemRecord?.type === "event_msg" ? itemRecord.payload : itemRecord;
      const role = readRole(candidate);
      const text = readText(candidate);
      if (!role || !text) continue;
      messages.push({ role, text });
    }
  }

  if (messages.length) return messages;

  const candidates = [
    ...asArray(root?.items),
    ...asArray(root?.thread?.items),
    ...asArray(root?.entries),
    ...asArray(root?.thread?.entries)
  ];
  for (const candidate of candidates) {
    const candidateRecord = candidate as any;
    const payload = candidateRecord?.type === "event_msg" ? candidateRecord.payload : candidateRecord;
    const role = readRole(payload);
    const text = readText(payload);
    if (!role || !text) continue;
    messages.push({ role, text });
  }

  return messages;
}

function readRole(input: any): "user" | "assistant" | null {
  const type = String(input?.type ?? "");
  const role = String(input?.role ?? "");
  if (type === "userMessage" || type === "user_message" || role === "user") return "user";
  if (type === "agentMessage" || type === "agent_message" || role === "assistant") return "assistant";
  return null;
}

function readText(input: any): string {
  const direct = firstString(input?.text, input?.message, input?.content);
  if (direct) return direct;
  const content = asArray(input?.content);
  const fromContent = content
    .map((part) => firstString((part as any)?.text, (part as any)?.message))
    .filter(Boolean)
    .join("\n");
  if (fromContent) return fromContent;
  const textElements = asArray(input?.text_elements);
  return textElements
    .map((part) => firstString((part as any)?.text, (part as any)?.content))
    .filter(Boolean)
    .join("\n");
}

function truncateText(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trim()}...`;
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}
