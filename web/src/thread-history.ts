import { agentEventPartId, eventToAgentEvent, isAgentEventSourceEvent, isGenericTurnAgentEventSourceEvent, isUnknownCodexItemEvent, isUnknownRawResponseItemEvent } from "./agent-events.js";
import { durationFromTiming, formatJsonValue, isCodexToolItem, isContextCompactionItem, isSubagentItem, normalizeContextCompactionMarker, normalizeRawResponseToolCall, normalizeRawResponseToolOutput, normalizeReasoningItem, normalizeSubagentCallFromItem, normalizeTokenUsage, normalizeToolCallFromItem, pathBasename, readPath } from "./codex-normalizers.js";
import type { BridgeEvent, UiAgentEvent, UiAssistantPart, UiMessage, UiToolCall, UploadedAttachment } from "./types.js";

export function eventsToMessages(events: BridgeEvent[]): UiMessage[] {
  const messages: UiMessage[] = [];
  const byTurn = new Map<string, UiMessage>();
  const userMessagesByTurn = new Map<string, number>();

  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.type === "thread/compacted" || event.type === "codex.thread/compacted") {
      messages.push(normalizeContextCompactionMarker({
        id: String(readPath<string>(event, ["payload", "params", "turnId"]) ?? readPath<string>(event, ["payload", "turnId"]) ?? event.turnId ?? `context-compaction-${event.seq}`),
        turnId: readPath<string>(event, ["payload", "params", "turnId"]) ?? event.turnId,
        createdAt: Date.parse(event.createdAt) || undefined
      }));
      continue;
    }
    if (event.type === "turn.started") {
      const turnId = event.turnId;
      if (turnId) {
        const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
        assistant.turnStartedAt = Date.parse(String(readPath<string>(event, ["payload", "startedAt"]) ?? "")) || Date.parse(event.createdAt) || assistant.createdAt;
      }
      continue;
    }
    if (event.type === "turn.completed") {
      const turnId = event.turnId;
      if (turnId) {
        const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
        assistant.turnStartedAt = assistant.turnStartedAt ?? (Date.parse(String(readPath<string>(event, ["payload", "startedAt"]) ?? "")) || assistant.createdAt);
        assistant.turnCompletedAt = Date.parse(String(readPath<string>(event, ["payload", "completedAt"]) ?? "")) || Date.parse(event.createdAt) || undefined;
        assistant.turnDurationMs = durationFromTiming(assistant.turnStartedAt, assistant.turnCompletedAt);
        assistant.isStreaming = false;
        const status = readPath<string>(event, ["payload", "status"]);
        if (status === "interrupted") {
          assistant.statusText = "已停止生成";
          assistant.statusTone = "danger";
        } else if (status === "failed") {
          assistant.statusText = failureMessageFromEvent(event) ?? "生成失败";
          assistant.statusTone = "danger";
        }
      }
      continue;
    }
    if (event.type === "codex.thread/tokenUsage/updated") {
      const turnId = event.turnId ?? readPath<string>(event, ["payload", "params", "turnId"]);
      if (turnId) {
        const assistant = byTurn.get(turnId);
        if (assistant) assistant.tokenUsage = normalizeTokenUsage(event);
      }
      continue;
    }
    if (event.type === "codex.item/agentMessage/delta") continue;
    const turnId = event.turnId;
    if (turnId && isAgentEventSourceEvent(event)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      appendAgentEventPart(assistant, eventToAgentEvent(event), event);
      continue;
    }
    if (turnId && isGenericTurnAgentEventSourceEvent(event)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      appendAgentEventPart(assistant, eventToAgentEvent(event), event);
      continue;
    }
    const item = readPath<Record<string, unknown>>(event, ["payload", "params", "item"]);
    if (!turnId || !item) continue;

    if (event.type === "codex.item/completed" && isContextCompactionItem(item)) {
      messages.push(normalizeContextCompactionMarker({
        id: String(item.id ?? `context-compaction-${event.seq}`),
        turnId,
        createdAt: Date.parse(event.createdAt) || undefined
      }));
      continue;
    }

    if (event.type === "codex.rawResponseItem/started" && isUnknownRawResponseItemEvent(event)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      appendAgentEventPart(assistant, eventToAgentEvent(event), event);
      continue;
    }

    if (event.type === "codex.rawResponseItem/completed") {
      const rawToolCall = normalizeRawResponseToolCall(item);
      const assistant = rawToolCall ? ensureAssistantTurn(messages, byTurn, turnId, event.createdAt) : null;
      if (assistant && rawToolCall) {
        upsertAssistantToolPart(assistant, rawToolCall);
        continue;
      }
      const rawToolOutput = normalizeRawResponseToolOutput(item);
      if (rawToolOutput) {
        const existing = byTurn.get(turnId);
        if (existing) updateAssistantToolPart(existing, rawToolOutput.id, (toolCall) => ({
          ...toolCall,
          status: "completed",
          result: rawToolOutput.output,
          aggregatedOutput: typeof rawToolOutput.output === "string" ? rawToolOutput.output : formatJsonValue(rawToolOutput.output)
        }));
        continue;
      }
      if (isUnknownRawResponseItemEvent(event)) {
        const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
        appendAgentEventPart(assistant, eventToAgentEvent(event), event);
      }
      continue;
    }

    if (event.type === "codex.item/completed" && item.type === "userMessage") {
      const seen = userMessagesByTurn.get(turnId) ?? 0;
      userMessagesByTurn.set(turnId, seen + 1);
      const text = readText(item);
      if (seen > 0 && text) {
        const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
        upsertSteerMessage(assistant, {
          id: String(item.id ?? `steer-${event.seq}`),
          text,
          status: "sent"
        });
      }
      continue;
    }

    if (item.type === "agentMessage" && typeof item.id === "string" && typeof item.text === "string") {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      replaceAssistantTextPart(assistant, item.id, item.text);
      continue;
    }

    const reasoning = normalizeReasoningItem(item);
    if (reasoning) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      upsertReasoningPart(assistant, reasoning.id, reasoning.text, reasoning.summary);
      continue;
    }

    if (isCodexToolItem(item)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      upsertAssistantToolPart(assistant, normalizeToolCallFromItem(item));
      continue;
    }

    if (isSubagentItem(item)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      upsertAssistantSubagentPart(assistant, normalizeSubagentCallFromItem(item));
      continue;
    }

    if (isUnknownCodexItemEvent(event)) {
      const assistant = ensureAssistantTurn(messages, byTurn, turnId, event.createdAt);
      appendAgentEventPart(assistant, eventToAgentEvent(event), event);
    }
  }

  return messages.filter((message) => message.role === "assistant" ? Boolean(message.text.trim() || message.assistantParts?.length || message.steerMessages?.length || message.statusText) : true);
}

export function threadReadToMessages(input: unknown): UiMessage[] {
  const turns = collectTurns(input);
  const messages: UiMessage[] = [];
  turns.forEach((turn, turnIndex) => {
    const turnId = String((turn as any)?.id ?? (turn as any)?.turnId ?? `turn-${turnIndex}`);
    const items = asArray((turn as any)?.items);
    const turnStartedAt = readTurnTimestamp(turn) ?? undefined;
    const turnCompletedAt = readTurnCompletedTimestamp(turn) ?? undefined;
    const compactOnlyTurn = isManualCompactTurn(items);
    if (compactOnlyTurn) {
      messages.push(createManualCompactUserMessage(turnId, turnStartedAt));
    }
    let assistant: UiMessage | null = null;
    let userMessageCount = 0;
    items.forEach((candidate, itemIndex) => {
      const systemMarker = candidateToSystemMarker(candidate, itemIndex, turnStartedAt, turnId);
      if (systemMarker) {
        messages.push(systemMarker);
        return;
      }
      const userMessage = candidateToMessage(candidate, itemIndex, turnStartedAt);
      if (userMessage?.role === "user") {
        if (userMessageCount === 0) {
          messages.push({ ...userMessage, turnId });
        } else {
          if (!assistant) {
            assistant = createAssistantTurn(turnId, turnStartedAt, turnCompletedAt, turn);
            messages.push(assistant);
          }
          upsertSteerMessage(assistant, {
            id: userMessage.id,
            text: userMessage.text,
            status: "sent"
          });
        }
        userMessageCount += 1;
        return;
      }

      const toolCall = candidateToToolCall(candidate);
      const subagent = candidateToSubagent(candidate);
      const reasoning = candidateToReasoning(candidate);
      const assistantMessage = userMessage?.role === "assistant" ? userMessage : null;
      if ((assistantMessage || toolCall || subagent || reasoning) && !assistant) {
      assistant = createAssistantTurn(turnId, turnStartedAt, turnCompletedAt, turn);
        messages.push(assistant);
      }
      if (assistantMessage && assistant) {
        replaceAssistantTextPart(assistant, assistantMessage.id, assistantMessage.text);
      }
      if (toolCall && assistant) {
        upsertAssistantToolPart(assistant, toolCall);
      }
      if (subagent && assistant) {
        upsertAssistantSubagentPart(assistant, subagent);
      }
      if (reasoning && assistant) {
        upsertReasoningPart(assistant, reasoning.id, reasoning.text, reasoning.summary);
      }
    });
  });
  if (messages.length) return messages;

  const candidates = collectMessageCandidates(input);
  candidates.forEach((candidate, index) => {
    const systemMarker = candidateToSystemMarker(candidate, index);
    if (systemMarker) {
      messages.push(systemMarker);
      return;
    }
    const message = candidateToMessage(candidate, index);
    if (message) messages.push(message);
  });
  return messages;
}

function readTurnTimestamp(turn: unknown): number | null {
  const value = (turn as any)?.startedAt;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") return Date.parse(value) || null;
  return null;
}

function readTurnCompletedTimestamp(turn: unknown): number | null {
  const value = (turn as any)?.completedAt;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") return Date.parse(value) || null;
  return null;
}

function createAssistantTurn(turnId: string, turnStartedAt: number | undefined, turnCompletedAt: number | undefined, turn: unknown): UiMessage {
  return {
    id: `assistant-turn-${turnId}`,
    role: "assistant",
    turnId,
    text: "",
    createdAt: turnStartedAt,
    turnStartedAt,
    turnCompletedAt,
    turnDurationMs: typeof (turn as any)?.durationMs === "number" ? (turn as any).durationMs : durationFromTiming(turnStartedAt, turnCompletedAt)
  };
}

function collectTurns(input: unknown): unknown[] {
  const root = input as any;
  return [
    ...asArray(root?.turns),
    ...asArray(root?.thread?.turns)
  ];
}

function collectMessageCandidates(input: unknown): unknown[] {
  const root = input as any;
  const directItems = asArray(root?.items);
  const threadItems = asArray(root?.thread?.items);
  const directEntries = asArray(root?.entries);
  const threadEntries = asArray(root?.thread?.entries);
  const directTurns = asArray(root?.turns);
  const threadTurns = asArray(root?.thread?.turns);
  const turnItems = [...directTurns, ...threadTurns].flatMap((turn) => asArray((turn as any)?.items));
  return [...directItems, ...threadItems, ...turnItems, ...directEntries, ...threadEntries];
}

function candidateToMessage(candidate: unknown, index: number, fallbackTimestamp?: number): UiMessage | null {
  const item = candidate as any;
  const payload = item?.type === "event_msg" ? item.payload : item;
  const role = roleFor(payload);
  if (!role) return null;
  const text = readText(payload);
  const attachments = role === "user" ? readAttachments(payload, text) : [];
  const visibleText = role === "user" ? stripInjectedFilePaths(text) : text;
  if (!visibleText && !attachments.length) return null;
  return {
    id: String(payload.id ?? item.id ?? `${role}-${index}`),
    role,
    text: visibleText,
    createdAt: readMessageTimestamp(payload, item) ?? fallbackTimestamp,
    images: attachments.filter((attachment): attachment is Extract<UploadedAttachment, { kind: "image" }> => attachment.kind === "image"),
    attachments
  };
}

function readMessageTimestamp(payload: Record<string, unknown>, item: Record<string, unknown>): number | null {
  return firstTimestamp(
    payload.createdAt,
    payload.timestamp,
    payload.created_at,
    item.createdAt,
    item.timestamp,
    item.created_at
  );
}

function firstTimestamp(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 10_000_000_000 ? value * 1000 : value;
    }
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (parsed) return parsed;
    }
  }
  return null;
}

function candidateToToolCall(candidate: unknown): UiToolCall | null {
  const item = (candidate as any)?.type === "event_msg" ? (candidate as any).payload : candidate as any;
  if (!isCodexToolItem(item)) return null;
  return normalizeToolCallFromItem(item);
}

function candidateToSubagent(candidate: unknown): Extract<UiAssistantPart, { type: "subagent" }>["subagent"] | null {
  const item = (candidate as any)?.type === "event_msg" ? (candidate as any).payload : candidate as any;
  if (!isSubagentItem(item)) return null;
  return normalizeSubagentCallFromItem(item);
}

function candidateToReasoning(candidate: unknown): { id: string; text: string; summary?: boolean } | null {
  const item = (candidate as any)?.type === "event_msg" ? (candidate as any).payload : candidate as any;
  return normalizeReasoningItem(item);
}

function isManualCompactTurn(items: unknown[]): boolean {
  return items.length > 0 && items.every((item) => {
    const payload = (item as any)?.type === "event_msg" ? (item as any).payload : item;
    return isContextCompactionItem(payload as Record<string, unknown>);
  });
}

function createManualCompactUserMessage(turnId: string, createdAt?: number): UiMessage {
  return {
    id: `compact-user-${turnId}`,
    role: "user",
    text: "/compact",
    turnId,
    createdAt,
    synthetic: "manualCompact"
  };
}

function candidateToSystemMarker(candidate: unknown, index: number, fallbackTimestamp?: number, fallbackTurnId?: string): UiMessage | null {
  const item = (candidate as any)?.type === "event_msg" ? (candidate as any).payload : candidate as any;
  if (!isContextCompactionItem(item)) return null;
  return normalizeContextCompactionMarker({
    id: String(item.id ?? (candidate as any)?.id ?? `context-compaction-${index}`),
    turnId: typeof item.turnId === "string" ? item.turnId : typeof (candidate as any)?.turnId === "string" ? (candidate as any).turnId : fallbackTurnId,
    createdAt: readMessageTimestamp(item, candidate as Record<string, unknown>) ?? fallbackTimestamp
  });
}

function ensureAssistantTurn(messages: UiMessage[], byTurn: Map<string, UiMessage>, turnId: string, createdAt: string): UiMessage {
  const existing = byTurn.get(turnId);
  if (existing) return existing;
  const message: UiMessage = {
    id: `assistant-turn-${turnId}`,
    role: "assistant",
    turnId,
    text: "",
    createdAt: Date.parse(createdAt) || undefined
  };
  byTurn.set(turnId, message);
  messages.push(message);
  return message;
}

function replaceAssistantTextPart(message: UiMessage, partId: string, text: string): void {
  const parts = upsertTextPart(message.assistantParts, { type: "text", id: partId, text });
  message.assistantParts = parts;
  message.text = joinAssistantText(parts);
}

function upsertAssistantToolPart(message: UiMessage, toolCall: UiToolCall): void {
  const parts = message.assistantParts ?? [];
  message.assistantParts = parts.some((part) => part.type === "tool" && part.id === toolCall.id)
    ? parts.map((part) => part.type === "tool" && part.id === toolCall.id ? { ...part, toolCall } : part)
    : [...parts, { type: "tool", id: toolCall.id, toolCall }];
}

function upsertAssistantSubagentPart(message: UiMessage, subagent: Extract<UiAssistantPart, { type: "subagent" }>["subagent"]): void {
  const parts = message.assistantParts ?? [];
  message.assistantParts = parts.some((part) => part.type === "subagent" && part.id === subagent.id)
    ? parts.map((part) => part.type === "subagent" && part.id === subagent.id ? { ...part, subagent } : part)
    : [...parts, { type: "subagent", id: subagent.id, subagent }];
}

function updateAssistantToolPart(message: UiMessage, itemId: string, updater: (toolCall: UiToolCall) => UiToolCall): void {
  const parts = message.assistantParts ?? [];
  message.assistantParts = parts.map((part) => part.type === "tool" && part.id === itemId ? { ...part, toolCall: updater(part.toolCall) } : part);
}

function upsertReasoningPart(message: UiMessage, partId: string, text: string, summary?: boolean): void {
  const parts = message.assistantParts ?? [];
  message.assistantParts = parts.some((part) => part.type === "reasoning" && part.id === partId)
    ? parts.map((part) => part.type === "reasoning" && part.id === partId ? { ...part, text, summary } : part)
    : [...parts, { type: "reasoning", id: partId, text, summary }];
}

function appendAgentEventPart(message: UiMessage, event: UiAgentEvent, source: BridgeEvent): void {
  message.assistantParts = [
    ...(message.assistantParts ?? []),
    {
      type: "agentEvent",
      id: agentEventPartId(source, message.assistantParts?.length ?? 0),
      event
    }
  ];
}

function upsertSteerMessage(message: UiMessage, steer: { id: string; text: string; status: "queued" | "submitted" | "sent" | "failed" }): void {
  const existing = message.steerMessages ?? [];
  if (existing.some((item) => item.id === steer.id || item.text === steer.text)) {
    message.steerMessages = existing.map((item) => item.id === steer.id || item.text === steer.text ? { ...item, ...steer } : item);
  } else {
    message.steerMessages = [...existing, steer];
  }
  message.assistantParts = upsertSteerPart(message.assistantParts, steer);
}

function upsertSteerPart(current: UiAssistantPart[] | undefined, steer: { id: string; text: string; status: "queued" | "submitted" | "sent" | "failed" }): UiAssistantPart[] {
  const parts = current ?? [];
  if (!parts.some((part) => part.type === "steer" && (part.id === steer.id || part.text === steer.text))) {
    return [...parts, { type: "steer", ...steer }];
  }
  return parts.map((part) => part.type === "steer" && (part.id === steer.id || part.text === steer.text)
    ? { ...part, id: steer.id, text: steer.text, status: steer.status }
    : part);
}

function upsertTextPart(current: UiAssistantPart[] | undefined, nextPart: Extract<UiAssistantPart, { type: "text" }>): UiAssistantPart[] {
  const existing = current ?? [];
  if (!existing.some((part) => part.type === "text" && part.id === nextPart.id)) return [...existing, nextPart];
  return existing.map((part) => part.type === "text" && part.id === nextPart.id ? nextPart : part);
}

function joinAssistantText(parts: UiAssistantPart[]): string {
  return parts
    .filter((part): part is Extract<UiAssistantPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function roleFor(input: any): UiMessage["role"] | null {
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

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function failureMessageFromEvent(event: BridgeEvent): string | undefined {
  return firstString(
    readPath<string>(event, ["payload", "error", "message"]),
    readPath<string>(event, ["payload", "error", "detail"]),
    readPath<string>(event, ["payload", "message"]),
    readPath<string>(event, ["payload", "params", "turn", "error", "message"]),
    readPath<string>(event, ["payload", "params", "turn", "error", "detail"])
  ) || undefined;
}

function readAttachments(payload: any, text: string): UploadedAttachment[] {
  return [
    ...readImageAttachments(payload),
    ...readInjectedFileAttachments(text)
  ];
}

function readImageAttachments(payload: any): UploadedAttachment[] {
  return asArray(payload?.content)
    .filter((part: any) => part?.type === "localImage" && typeof part.path === "string")
    .map((part: any, index) => ({
      id: String(part.id ?? `image-${index}-${part.path}`),
      kind: "image" as const,
      name: pathBasename(part.path),
      mimeType: "image/*",
      previewUrl: `/api/uploads/images/${encodeURIComponent(pathBasename(part.path))}`,
      input: {
        type: "localImage" as const,
        path: part.path,
        detail: part.detail ?? "high"
      }
    }));
}

function readInjectedFileAttachments(text: string): UploadedAttachment[] {
  return injectedFileLines(text).map((line, index) => {
    const parsed = /^-\s*(.+?):\s*(.+)$/.exec(line.trim());
    const path = parsed?.[2]?.trim() ?? line.trim();
    const name = parsed?.[1]?.trim() || pathBasename(path);
    return {
      id: `file-${index}-${path}`,
      kind: "file" as const,
      name,
      mimeType: "application/octet-stream",
      size: 0,
      path
    };
  });
}

function stripInjectedFilePaths(text: string): string {
  const marker = "用户上传了以下本地临时文件，请按需读取或处理：";
  const index = text.indexOf(marker);
  if (index < 0) return text;
  return text.slice(0, index).trim();
}

function injectedFileLines(text: string): string[] {
  const marker = "用户上传了以下本地临时文件，请按需读取或处理：";
  const index = text.indexOf(marker);
  if (index < 0) return [];
  return text
    .slice(index + marker.length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
}
