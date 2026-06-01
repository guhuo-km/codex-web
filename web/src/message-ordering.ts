import type { UiMessage } from "./types.js";

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
