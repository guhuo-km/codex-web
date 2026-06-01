import { createGunzip, createGzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BridgeEvent, TurnJob } from "../events/event-store.js";

export interface JsonlStoreOptions {
  maxArchives?: number;
}

export class JsonlStore {
  private ready: Promise<void> | null = null;
  private eventWriteQueue: Promise<void> = Promise.resolve();
  private turnWriteQueue: Promise<void> = Promise.resolve();
  private readonly maxArchives: number;

  constructor(private readonly dataDir: string, options: JsonlStoreOptions = {}) {
    this.maxArchives = normalizePositiveInteger(options.maxArchives) ?? 3;
  }

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

  async replaceEvents(events: BridgeEvent[]): Promise<void> {
    this.eventWriteQueue = this.eventWriteQueue
      .catch(() => undefined)
      .then(async () => {
        await this.ensureReady();
        const path = this.eventFilePath();
        const tempPath = `${path}.tmp`;
        const body = events.length ? `${events.map((event) => JSON.stringify(event)).join("\n")}\n` : "";
        await writeFile(tempPath, body, "utf8");
        let archivedPath: string | undefined;
        let originalRemoved = false;
        try {
          archivedPath = await this.archiveFile(path);
          if (archivedPath) {
            await rm(path, { force: true });
            originalRemoved = true;
          }
          await rename(tempPath, path);
        } catch (error) {
          await rm(tempPath, { force: true }).catch(() => undefined);
          if (archivedPath && originalRemoved) {
            await this.restoreArchive(archivedPath, path).catch(() => undefined);
          }
          throw error;
        }
        await this.pruneArchives();
      });
    await this.eventWriteQueue;
  }

  async stats(): Promise<Record<string, unknown>> {
    await this.ensureReady();
    const eventFile = await fileStats(this.eventFilePath());
    const turnFile = await fileStats(join(this.dataDir, "turns.jsonl"));
    const archives = await this.listEventArchives();
    const archiveStats = await Promise.all(archives.map(async (archive) => ({
      name: basename(archive),
      ...(await fileStats(archive))
    })));
    return {
      eventsFile: eventFile,
      turnsFile: turnFile,
      eventArchives: archiveStats
    };
  }

  private async ensureReady(): Promise<void> {
    this.ready ??= mkdir(this.dataDir, { recursive: true }).then(() => undefined);
    return this.ready;
  }

  private eventFilePath(): string {
    return join(this.dataDir, "events.jsonl");
  }

  private async archiveFile(path: string): Promise<string | undefined> {
    try {
      await stat(path);
    } catch (error: any) {
      if (error?.code === "ENOENT") return undefined;
      throw error;
    }
    const archivePath = `${path}.${timestampSlug(new Date())}.archive.gz`;
    await pipeline(createReadStream(path), createGzip(), createWriteStream(archivePath));
    return archivePath;
  }

  private async restoreArchive(archivePath: string, targetPath: string): Promise<void> {
    await pipeline(createReadStream(archivePath), createGunzip(), createWriteStream(targetPath));
  }

  private async pruneArchives(): Promise<void> {
    const archives = await this.listEventArchives();
    const extra = archives.slice(this.maxArchives);
    await Promise.all(extra.map((path) => rm(path, { force: true })));
  }

  private async listEventArchives(): Promise<string[]> {
    await this.ensureReady();
    const entries = await readdir(this.dataDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^events\.jsonl\.\d{8}-\d{6}\.archive\.gz$/.test(entry.name))
      .map((entry) => join(this.dataDir, entry.name))
      .sort()
      .reverse();
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

async function fileStats(path: string): Promise<{ exists: boolean; sizeBytes?: number; modifiedAt?: string }> {
  try {
    const result = await stat(path);
    return {
      exists: true,
      sizeBytes: result.size,
      modifiedAt: result.mtime.toISOString()
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function timestampSlug(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").replace("T", "-");
}

function normalizePositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}
