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
    isStreaming: true
  };
  return upsertMessagesById(messages, [userMessage, assistantMessage]);
}

export function mergeLoadedMessagesWithCurrent(loadedMessages: UiMessage[], currentMessages: UiMessage[]): UiMessage[] {
  if (!currentMessages.length) return loadedMessages;
  const loadedIds = new Set(loadedMessages.map((message) => message.id));
  const loadedTurns = new Set(loadedMessages.map((message) => message.turnId).filter(Boolean));
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const merged = loadedMessages.map((message) => {
    const current = currentById.get(message.id);
    if (!current) return message;
    if (current.isStreaming && message.role === "assistant") {
      return { ...message, isStreaming: true, turnStartedAt: current.turnStartedAt ?? message.turnStartedAt };
    }
    return message;
  });

  for (const current of currentMessages) {
    if (loadedIds.has(current.id)) continue;
    if (current.turnId && loadedTurns.has(current.turnId)) continue;
    if (isLocalPendingMessage(current)) merged.push(current);
  }

  return merged;
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

function upsertMessagesById(messages: UiMessage[], nextMessages: UiMessage[]): UiMessage[] {
  const byId = new Map(nextMessages.map((message) => [message.id, message]));
  const next = messages.map((message) => byId.get(message.id) ?? message);
  for (const message of nextMessages) {
    if (!messages.some((current) => current.id === message.id)) next.push(message);
  }
  return next;
}

function isLocalPendingMessage(message: UiMessage): boolean {
  if (message.id.startsWith("user-turn-")) return true;
  if (message.id.startsWith("assistant-turn-") && message.isStreaming) return true;
  if (message.id.startsWith("pending-assistant-")) return true;
  return false;
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
