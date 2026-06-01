import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BridgeEvent, TurnJob } from "../events/event-store.js";

export class JsonlStore {
  private ready: Promise<void> | null = null;
  private eventWriteQueue: Promise<void> = Promise.resolve();
  private turnWriteQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  async appendEvent(event: BridgeEvent): Promise<void> {
    this.eventWriteQueue = this.eventWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureReady();
        await appendFile(join(this.dataDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
      });
    await this.eventWriteQueue;
  }

  async upsertTurn(turn: TurnJob): Promise<void> {
    this.turnWriteQueue = this.turnWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureReady();
        const turns = await this.readTurns();
        const next = turns.filter((existing) => !(existing.threadId === turn.threadId && existing.turnId === turn.turnId));
        next.push(turn);
        await writeFile(join(this.dataDir, "turns.jsonl"), `${next.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
      });
    await this.turnWriteQueue;
  }

  async readEvents(): Promise<BridgeEvent[]> {
    return readJsonl<BridgeEvent>(join(this.dataDir, "events.jsonl"));
  }

  async readTurns(): Promise<TurnJob[]> {
    return readJsonl<TurnJob>(join(this.dataDir, "turns.jsonl"));
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= mkdir(this.dataDir, { recursive: true }).then(() => undefined);
    return this.ready;
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const text = await readFile(path, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
