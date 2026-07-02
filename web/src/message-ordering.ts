import type { UiMessage } from "./types.js";

export function appendOptimisticTurnMessages(
  messages: UiMessage[],
  input: { turnId: string; text: string; attachments?: UiMessage["attachments"]; startedAt?: number }
): UiMessage[] {
  const startedAt = input.startedAt ?? Date.now();
  const text = input.text.trim();
  const attachments = input.attachments ?? [];
  const userMessage: UiMessage = {
    id: `user-turn-${input.turnId}`,
    role: "user",
    turnId: input.turnId,
    text,
    createdAt: startedAt,
    attachments,
    images: attachments.filter((attachment) => attachment.kind === "image")
  };
  const assistantMessage: UiMessage = {
    id: `assistant-turn-${input.turnId}`,
    role: "assistant",
    turnId: input.turnId,
    text: "",
    createdAt: startedAt,
    turnStartedAt: startedAt,
    isStreaming: true,
    ...pendingAssistantCarryover(messages)
  };
  return upsertMessagesById(messages.filter((message) => !isPendingAssistantMessage(message)), [userMessage, assistantMessage]);
}

export function mergeLoadedMessagesWithCurrent(
  loadedMessages: UiMessage[],
  currentMessages: UiMessage[],
  options: { rollbackTargetUserMessageId?: string } = {}
): UiMessage[] {
  const trimmedLoadedMessages = messagesBeforeRollbackTarget(loadedMessages, options.rollbackTargetUserMessageId ?? "");
  if (!currentMessages.length) return trimmedLoadedMessages;
  const loadedIds = new Set(trimmedLoadedMessages.map((message) => message.id));
  const loadedTurnRoles = new Set(trimmedLoadedMessages.map(turnRoleKey).filter(Boolean));
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const merged = trimmedLoadedMessages.map((message) => {
    const current = currentById.get(message.id);
    if (!current) return message;
    if (current.isStreaming && message.role === "assistant") {
      return {
        ...message,
        isStreaming: true,
        turnStartedAt: current.turnStartedAt ?? message.turnStartedAt,
        assistantParts: mergeAssistantParts(message.assistantParts, current.assistantParts),
        statusText: current.statusText ?? message.statusText,
        statusTone: current.statusTone ?? message.statusTone
      };
    }
    return message;
  });

  for (const current of currentMessages) {
    if (loadedIds.has(current.id)) continue;
    const turnRole = turnRoleKey(current);
    if (turnRole && loadedTurnRoles.has(turnRole)) continue;
    if (isLocalPendingMessage(current)) insertLocalPendingMessage(merged, current);
  }

  return merged;
}

export function mergeThreadAndEventMessages(
  threadMessages: UiMessage[],
  eventMessages: UiMessage[],
  options: { preserveTurnIds?: string[] } = {}
): UiMessage[] {
  if (!eventMessages.length) return threadMessages;
  const preservedTurnIds = new Set(options.preserveTurnIds ?? []);
  const threadTurnIds = new Set(threadMessages.map((message) => message.turnId).filter(Boolean) as string[]);
  const retainedEventMessages = eventMessages.filter((message) => (
    message.turnId && (threadTurnIds.has(message.turnId) || preservedTurnIds.has(message.turnId))
  ));
  if (!threadMessages.length) return retainedEventMessages;
  if (!retainedEventMessages.length) return threadMessages;

  const eventMessagesByTurn = new Map<string, UiMessage[]>();
  for (const eventMessage of retainedEventMessages) {
    if (eventMessage.turnId) {
      eventMessagesByTurn.set(eventMessage.turnId, [...(eventMessagesByTurn.get(eventMessage.turnId) ?? []), eventMessage]);
    }
  }

  const result: UiMessage[] = [];
  for (const threadMessage of threadMessages) {
    if (threadMessage.role === "assistant" && threadMessage.turnId && eventMessagesByTurn.has(threadMessage.turnId)) {
      result.push(...(eventMessagesByTurn.get(threadMessage.turnId) ?? []));
      continue;
    }
    result.push(threadMessage);
  }
  return result;
}

export function upsertContextCompactionMarkerMessage(messages: UiMessage[], marker: UiMessage): UiMessage[] {
  const existingIndex = messages.findIndex((message) => (
    message.systemMarker === "contextCompaction" &&
    (message.id === marker.id || (Boolean(marker.turnId) && message.turnId === marker.turnId))
  ));
  const existing = existingIndex >= 0 ? messages[existingIndex] : undefined;
  const nextMarker = existing ? {
    ...existing,
    ...marker,
    createdAt: marker.createdAt ?? existing.createdAt,
    turnId: marker.turnId ?? existing.turnId
  } : marker;
  const baseMessages = existingIndex >= 0 ? messages.filter((_, index) => index !== existingIndex) : messages;
  const insertionIndex = contextCompactionMarkerIndex(baseMessages, nextMarker);
  return [
    ...baseMessages.slice(0, insertionIndex),
    nextMarker,
    ...baseMessages.slice(insertionIndex)
  ];
}

export function messagesBeforeRollbackTarget(messages: UiMessage[], userMessageId: string): UiMessage[] {
  const messageIndex = messages.findIndex((message) => message.id === userMessageId && message.role === "user");
  if (messageIndex < 0) return messages;
  return messages.slice(0, messageIndex);
}

function upsertMessagesById(messages: UiMessage[], nextMessages: UiMessage[]): UiMessage[] {
  const byId = new Map(nextMessages.map((message) => [message.id, message]));
  const next = messages.map((message) => byId.get(message.id) ?? message);
  for (const message of nextMessages) {
    if (!messages.some((current) => current.id === message.id)) next.push(message);
  }
  return next;
}

function mergeAssistantParts(
  loadedParts: UiMessage["assistantParts"],
  currentParts: UiMessage["assistantParts"]
): UiMessage["assistantParts"] {
  if (!currentParts?.length) return loadedParts;
  if (!loadedParts?.length) return currentParts;
  const loadedIds = new Set(loadedParts.map((part) => part.id));
  return [
    ...loadedParts,
    ...currentParts.filter((part) => !loadedIds.has(part.id))
  ];
}

function isLocalPendingMessage(message: UiMessage): boolean {
  if (message.id.startsWith("user-turn-")) return true;
  if (message.id.startsWith("assistant-turn-") && message.isStreaming) return true;
  if (message.id.startsWith("pending-assistant-")) return true;
  return false;
}

function insertLocalPendingMessage(messages: UiMessage[], message: UiMessage): void {
  if (message.turnId) {
    const sameTurnIndex = message.role === "user"
      ? messages.findIndex((current) => current.turnId === message.turnId)
      : findLastIndex(messages, (current) => current.turnId === message.turnId);
    if (sameTurnIndex >= 0) {
      const insertionIndex = message.role === "user" ? sameTurnIndex : sameTurnIndex + 1;
      messages.splice(insertionIndex, 0, message);
      return;
    }
  }

  const pendingTime = messageTime(message);
  if (pendingTime != null) {
    const laterIndex = messages.findIndex((current) => {
      const currentTime = messageTime(current);
      return currentTime != null && currentTime > pendingTime;
    });
    if (laterIndex >= 0) {
      messages.splice(laterIndex, 0, message);
      return;
    }
  }

  messages.push(message);
}

function turnRoleKey(message: UiMessage): string | undefined {
  return message.turnId ? `${message.turnId}:${message.role}` : undefined;
}

function pendingAssistantCarryover(messages: UiMessage[]): Partial<UiMessage> {
  const pending = messages.find(isPendingAssistantMessage);
  if (!pending) return {};
  return {
    assistantParts: pending.assistantParts,
    statusText: pending.statusText,
    statusTone: pending.statusTone
  };
}

function isPendingAssistantMessage(message: UiMessage): boolean {
  return message.role === "assistant" && message.id.startsWith("pending-assistant-");
}

function contextCompactionMarkerIndex(messages: UiMessage[], marker: UiMessage): number {
  if (marker.turnId) {
    const assistantIndex = messages.findIndex((message) => (
      message.role === "assistant" &&
      (message.turnId === marker.turnId || message.id === `assistant-turn-${marker.turnId}`)
    ));
    if (assistantIndex >= 0) return assistantIndex;

    const sameTurnIndex = findLastIndex(messages, (message) => message.turnId === marker.turnId);
    if (sameTurnIndex >= 0) return sameTurnIndex + 1;
  }

  const markerTime = messageTime(marker);
  if (markerTime != null) {
    const laterIndex = messages.findIndex((message) => {
      const time = messageTime(message);
      return time != null && time > markerTime;
    });
    if (laterIndex >= 0) return laterIndex;
  }

  return messages.length;
}

function messageTime(message: UiMessage): number | undefined {
  return message.createdAt ?? message.turnStartedAt ?? message.turnCompletedAt;
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index]!)) return index;
  }
  return -1;
}
