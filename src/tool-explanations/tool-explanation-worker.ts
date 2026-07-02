import type { BridgeEvent, EventStore } from "../events/event-store.js";
import type { ToolExplanationService } from "./tool-explanation-service.js";

export function attachToolExplanationWorker(events: EventStore, service: ToolExplanationService): () => void {
  return events.subscribe((event) => {
    const identity = commandExplanationIdentity(event);
    if (!identity) return;
    void service.explain(identity).catch((error) => {
      console.warn("Failed to explain command execution", error);
    });
  });
}

function commandExplanationIdentity(event: BridgeEvent): { threadId: string; turnId: string; toolCallId: string; command: string } | undefined {
  if (event.type !== "codex.item/completed" && event.type !== "codex.item/started") return undefined;
  if (!event.threadId || !event.turnId) return undefined;
  const item = readPath<Record<string, unknown>>(event, ["payload", "params", "item"]);
  if (item?.type !== "commandExecution") return undefined;
  const toolCallId = typeof item.id === "string" ? item.id : "";
  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (!toolCallId || !command) return undefined;
  return {
    threadId: event.threadId,
    turnId: event.turnId,
    toolCallId,
    command
  };
}

function readPath<T>(input: unknown, path: string[]): T | undefined {
  let current: any = input;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current as T | undefined;
}
