export interface BridgeEventInput {
  type: string;
  threadId?: string;
  turnId?: string;
  payload: unknown;
}

export interface BridgeEvent extends BridgeEventInput {
  seq: number;
  createdAt: string;
}

export type TurnJobStatus = "running" | "completed" | "failed" | "interrupted";
export type TurnJobKind = "normal" | "compact";

export interface TurnJob {
  threadId: string;
  turnId: string;
  status: TurnJobStatus;
  kind?: TurnJobKind;
  startedAt: string;
  completedAt?: string;
}

export interface TurnCompletionDetails {
  message?: string;
  error?: Record<string, unknown>;
}

export interface StaleRunningTurnOptions {
  staleAfterMs: number;
  now?: Date;
  protectedTurnKeys?: Set<string>;
}

export interface EventListFilter {
  threadId?: string;
  afterSeq?: number;
  limit?: number;
}

export interface EventPersistence {
  appendEvent(event: BridgeEvent): Promise<void>;
  upsertTurn(turn: TurnJob): Promise<void>;
  readEvents(): Promise<BridgeEvent[]>;
  readTurns(): Promise<TurnJob[]>;
  replaceEvents?(events: BridgeEvent[]): Promise<void>;
  stats?(): Promise<Record<string, unknown>>;
}

type EventListener = (event: BridgeEvent) => void;

export interface EventStoreOptions {
  maxEvents?: number;
  maxEventBytes?: number;
}

export interface EventStoreStats {
  eventCount: number;
  turnCount: number;
  runningTurnCount: number;
  listenerCount: number;
  nextSeq: number;
  retainedEventLimit?: number;
  retainedEventBytesLimit?: number;
  retainedEventBytes: number;
  oldestEventSeq?: number;
  newestEventSeq?: number;
  oldestEventAt?: string;
  newestEventAt?: string;
}

export class EventStore {
  private nextSeq = 1;
  private readonly events: BridgeEvent[] = [];
  private readonly turns = new Map<string, TurnJob>();
  private readonly pendingCompactThreads = new Set<string>();
  private readonly listeners = new Set<EventListener>();
  private readonly maxEvents?: number;
  private readonly maxEventBytes?: number;
  private eventBytes = 0;

  constructor(private readonly persistence?: EventPersistence, options: EventStoreOptions = {}) {
    this.maxEvents = normalizePositiveInteger(options.maxEvents);
    this.maxEventBytes = normalizePositiveInteger(options.maxEventBytes);
  }

  async load(): Promise<void> {
    if (!this.persistence) return;
    const [events, turns] = await Promise.all([
      this.persistence.readEvents(),
      this.persistence.readTurns()
    ]);
    let maxSeq = 0;
    for (const event of events) {
      if (event.seq > maxSeq) maxSeq = event.seq;
    }
    this.events.length = 0;
    for (const event of events.sort((a, b) => a.seq - b.seq)) {
      this.events.push(event);
      this.eventBytes += eventSize(event);
    }
    this.pruneEvents();
    this.turns.clear();
    for (const turn of turns) {
      this.turns.set(turnKey(turn.threadId, turn.turnId), turn);
    }
    this.nextSeq = maxSeq + 1;
  }

  append(input: BridgeEventInput): BridgeEvent {
    const event: BridgeEvent = {
      ...input,
      seq: this.nextSeq++,
      createdAt: new Date().toISOString()
    };
    this.events.push(event);
    this.eventBytes += eventSize(event);
    this.pruneEvents();
    void this.persistence?.appendEvent(event).catch((error) => {
      console.error("Failed to persist bridge event", error);
    });
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  list(filter: EventListFilter = {}): BridgeEvent[] {
    const filtered = this.events.filter((event) => {
      if (filter.threadId && event.threadId !== filter.threadId) return false;
      if (filter.afterSeq !== undefined && event.seq <= filter.afterSeq) return false;
      return true;
    });
    const limit = normalizePositiveInteger(filter.limit);
    return limit && filtered.length > limit ? filtered.slice(-limit) : filtered;
  }

  async compactPersistence(): Promise<void> {
    await this.persistence?.replaceEvents?.(this.events);
  }

  async persistenceStats(): Promise<Record<string, unknown> | undefined> {
    return this.persistence?.stats?.();
  }

  stats(): EventStoreStats {
    const oldest = this.events[0];
    const newest = this.events.at(-1);
    return {
      eventCount: this.events.length,
      turnCount: this.turns.size,
      runningTurnCount: this.getRunningTurns().length,
      listenerCount: this.listeners.size,
      nextSeq: this.nextSeq,
      retainedEventLimit: this.maxEvents,
      retainedEventBytesLimit: this.maxEventBytes,
      retainedEventBytes: this.eventBytes,
      oldestEventSeq: oldest?.seq,
      newestEventSeq: newest?.seq,
      oldestEventAt: oldest?.createdAt,
      newestEventAt: newest?.createdAt
    };
  }

  markNextTurnCompact(threadId: string): void {
    this.pendingCompactThreads.add(threadId);
  }

  recordTurnStart(threadId: string, turnId: string, kind?: TurnJobKind): TurnJob {
    const nextKind = kind ?? (this.pendingCompactThreads.has(threadId) ? "compact" : "normal");
    this.pendingCompactThreads.delete(threadId);
    const job: TurnJob = {
      threadId,
      turnId,
      status: "running",
      kind: nextKind,
      startedAt: new Date().toISOString()
    };
    this.turns.set(turnKey(threadId, turnId), job);
    void this.persistence?.upsertTurn(job).catch((error) => {
      console.error("Failed to persist turn start", error);
    });
    this.append({ type: "turn.started", threadId, turnId, payload: job });
    return job;
  }

  recordTurnComplete(threadId: string, turnId: string, status: TurnJobStatus, details: TurnCompletionDetails = {}): TurnJob {
    const key = turnKey(threadId, turnId);
    const existing = this.turns.get(key);
    const job: TurnJob = {
      threadId,
      turnId,
      status,
      kind: existing?.kind ?? "normal",
      startedAt: existing?.startedAt || new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
    this.turns.set(key, job);
    void this.persistence?.upsertTurn(job).catch((error) => {
      console.error("Failed to persist turn completion", error);
    });
    this.append({
      type: "turn.completed",
      threadId,
      turnId,
      payload: {
        ...job,
        message: details.message,
        error: details.error
      }
    });
    return job;
  }

  getRunningTurns(): TurnJob[] {
    return [...this.turns.values()]
      .filter((turn) => turn.status === "running")
      .map((turn) => ({ ...turn, kind: turn.kind ?? "normal" }));
  }

  interruptStaleRunningTurns(options: StaleRunningTurnOptions): TurnJob[] {
    const nowMs = (options.now ?? new Date()).getTime();
    const stale: TurnJob[] = [];
    for (const turn of [...this.turns.values()]) {
      if (turn.status !== "running") continue;
      if (options.protectedTurnKeys?.has(turnKey(turn.threadId, turn.turnId))) continue;
      const lastActivityMs = Date.parse(this.lastActivityAt(turn) ?? turn.startedAt);
      if (!Number.isFinite(lastActivityMs) || nowMs - lastActivityMs <= options.staleAfterMs) continue;
      stale.push(this.recordTurnComplete(turn.threadId, turn.turnId, "interrupted", {
        message: "Turn marked interrupted after no activity"
      }));
    }
    return stale;
  }

  listTurns(): TurnJob[] {
    return [...this.turns.values()]
      .map((turn) => ({ ...turn, kind: turn.kind ?? "normal" }));
  }

  getTurn(threadId: string, turnId: string): TurnJob | undefined {
    return this.turns.get(turnKey(threadId, turnId));
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private lastActivityAt(turn: TurnJob): string | undefined {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index];
      if (event.threadId === turn.threadId && event.turnId === turn.turnId) return event.createdAt;
    }
    return turn.completedAt ?? turn.startedAt;
  }

  private pruneEvents(): void {
    while (this.events.length && (
      (this.maxEvents !== undefined && this.events.length > this.maxEvents)
      || (this.maxEventBytes !== undefined && this.eventBytes > this.maxEventBytes)
    )) {
      const [removed] = this.events.splice(0, 1);
      if (removed) this.eventBytes = Math.max(0, this.eventBytes - eventSize(removed));
    }
  }

}

function turnKey(threadId: string, turnId: string): string {
  return `${threadId}:${turnId}`;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

function eventSize(event: BridgeEvent): number {
  return Buffer.byteLength(JSON.stringify(event), "utf8") + 1;
}
