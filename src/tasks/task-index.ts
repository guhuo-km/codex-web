import type { EventStore, TurnJob, TurnJobStatus } from "../events/event-store.js";

export interface TaskSummary {
  threadId: string;
  turnId: string;
  status: TurnJobStatus;
  kind: "normal" | "compact";
  startedAt: string;
  completedAt?: string;
  lastEventAt: string;
  lastSeq: number;
  eventCount: number;
}

export interface TaskListFilter {
  threadId?: string;
  status?: TurnJobStatus;
}

export function listTaskSummaries(events: EventStore, filter: TaskListFilter = {}): TaskSummary[] {
  return events
    .listTurns()
    .filter((turn) => !filter.threadId || turn.threadId === filter.threadId)
    .filter((turn) => !filter.status || turn.status === filter.status)
    .map((turn) => toTaskSummary(events, turn))
    .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt) || b.lastSeq - a.lastSeq);
}

function toTaskSummary(events: EventStore, turn: TurnJob): TaskSummary {
  const related = events.list({ threadId: turn.threadId }).filter((event) => event.turnId === turn.turnId);
  const lastEvent = related.at(-1);
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    status: turn.status,
    kind: turn.kind ?? "normal",
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    lastEventAt: lastEvent?.createdAt ?? turn.completedAt ?? turn.startedAt,
    lastSeq: lastEvent?.seq ?? 0,
    eventCount: related.length
  };
}
