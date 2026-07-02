import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createReadStream } from "node:fs";
import { opendir, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { loadSessionIndex, saveSessionIndex, type SessionIndexEntry } from "./session-history-index.js";

const ROLLOUT_READ_CONCURRENCY = 16;

export interface LocalThreadSummary {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
  status: "completed";
  parentThreadId?: string;
  threadSource?: string;
  agentNickname?: string;
  agentRole?: string;
  isSubagent?: boolean;
}

export interface ListLocalThreadsInput {
  codexHome?: string;
  indexDataDir?: string;
  cwd?: string;
  searchTerm?: string;
  limit?: number;
}

export async function listLocalCodexThreads(input: ListLocalThreadsInput = {}): Promise<LocalThreadSummary[]> {
  const codexHome = input.codexHome || join(homedir(), ".codex");
  const indexDataDir = input.indexDataDir || join(process.cwd(), ".data");
  const files = [
    ...await findRolloutFiles(join(codexHome, "sessions")),
    ...await findRolloutFiles(join(codexHome, "archived_sessions"))
  ];
  const cachedIndex = await loadSessionIndex(indexDataDir);
  const nextIndex = new Map<string, SessionIndexEntry>();
  const toRead: Array<{ file: string; mtimeMs: number; size: number }> = [];
  const threads: LocalThreadSummary[] = [];

  const fileStats = (await mapConcurrent(files, ROLLOUT_READ_CONCURRENCY, async (file) => {
    try {
      const info = await stat(file);
      return { file, mtimeMs: info.mtimeMs, size: info.size };
    } catch {
      return null;
    }
  })).filter((value): value is { file: string; mtimeMs: number; size: number } => Boolean(value));

  for (const file of fileStats) {
    const cached = cachedIndex.get(file.file);
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
      nextIndex.set(file.file, cached);
      threads.push(indexEntryToThread(cached));
      continue;
    }
    toRead.push(file);
  }

  const freshThreads = (await mapConcurrent(toRead, ROLLOUT_READ_CONCURRENCY, async (file) => {
    try {
      const result = await readRolloutSummary(file.file, file);
      if (!result) return null;
      const entry: SessionIndexEntry = {
        id: result.id,
        cwd: result.cwd,
        preview: result.preview,
        name: result.name ?? null,
        updatedAt: result.updatedAt,
        status: result.status,
        parentThreadId: result.parentThreadId,
        threadSource: result.threadSource,
        agentNickname: result.agentNickname,
        agentRole: result.agentRole,
        isSubagent: result.isSubagent,
        filePath: file.file,
        mtimeMs: file.mtimeMs,
        size: file.size
      };
      nextIndex.set(file.file, entry);
      return result;
    } catch (error) {
      console.warn("Failed to read Codex rollout summary", error);
      return null;
    }
  })).filter((thread): thread is LocalThreadSummary => Boolean(thread));

  threads.push(...freshThreads);
  await saveSessionIndex(indexDataDir, nextIndex.values()).catch((error) => {
    console.warn("Failed to persist Codex session index", error);
  });

  return threads
    .filter((thread) => !input.cwd || samePath(thread.cwd, input.cwd))
    .filter((thread) => matchesSearch(thread, input.searchTerm))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, input.limit ?? 50);
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

async function findRolloutFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const dir = await opendir(root, { recursive: true });
    for await (const entry of dir) {
      if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        files.push(join(entry.parentPath, entry.name));
      }
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  return files;
}

function indexEntryToThread(entry: SessionIndexEntry): LocalThreadSummary {
  return {
    id: entry.id,
    cwd: entry.cwd,
    preview: entry.preview,
    name: entry.name,
    updatedAt: entry.updatedAt,
    status: "completed",
    parentThreadId: entry.parentThreadId,
    threadSource: entry.threadSource,
    agentNickname: entry.agentNickname,
    agentRole: entry.agentRole,
    isSubagent: entry.isSubagent
  };
}

async function readRolloutSummary(file: string, fileInfo?: { mtimeMs: number; size: number }): Promise<LocalThreadSummary | null> {
  let id = idFromFile(file);
  let cwd = "";
  let preview = "";
  let name: string | null = null;
  let updatedAt = fileInfo?.mtimeMs ?? (await stat(file)).mtimeMs;
  let parentThreadId: string | undefined;
  let threadSource: string | undefined;
  let agentNickname: string | undefined;
  let agentRole: string | undefined;

  const reader = createInterface({
    input: createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  try {
    for await (const line of reader) {
      const record = safeJson(line);
      if (!record) continue;
      updatedAt = Math.max(updatedAt, timeFrom(record.timestamp));
      if (record.type === "session_meta") {
        id = String(record.payload?.id ?? id);
        cwd = String(record.payload?.cwd ?? cwd);
        parentThreadId = stringValue(record.payload?.parent_thread_id) ?? stringValue(record.payload?.parentThreadId) ?? parentThreadId;
        threadSource = stringValue(record.payload?.thread_source) ?? stringValue(record.payload?.threadSource) ?? threadSource;
        agentNickname = stringValue(record.payload?.agent_nickname) ?? stringValue(record.payload?.agentNickname) ?? agentNickname;
        agentRole = stringValue(record.payload?.agent_role) ?? stringValue(record.payload?.agentRole) ?? agentRole;
        updatedAt = Math.max(updatedAt, timeFrom(record.payload?.timestamp));
        continue;
      }
      if (record.type === "event_msg" && record.payload?.type === "user_message" && !preview) {
        preview = String(record.payload.message ?? "").trim();
      }
      if (cwd && preview) break;
    }
  } finally {
    reader.close();
  }

  if (!id || !cwd) return null;
  return {
    id,
    cwd,
    preview: preview || undefined,
    name,
    updatedAt: updatedAt || Date.now(),
    status: "completed",
    parentThreadId,
    threadSource,
    agentNickname,
    agentRole,
    isSubagent: Boolean(parentThreadId || threadSource === "subagent")
  };
}

function idFromFile(file: string): string {
  const match = /rollout-.+-(019[0-9a-f-]+)\.jsonl$/i.exec(basename(file));
  return match?.[1] ?? "";
}

function matchesSearch(thread: LocalThreadSummary, searchTerm?: string): boolean {
  if (!searchTerm) return true;
  const needle = searchTerm.toLowerCase();
  return [thread.id, thread.cwd, thread.preview, thread.name]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}

export function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  const leftResolved = resolve(left);
  const rightResolved = resolve(right);
  if (platform === "win32") {
    return leftResolved.toLowerCase() === rightResolved.toLowerCase();
  }
  return leftResolved === rightResolved;
}

function timeFrom(input: unknown): number {
  if (typeof input !== "string") return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeJson(line: string): any | null {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
