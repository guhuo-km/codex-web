import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SessionIndexEntry {
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
  filePath: string;
  mtimeMs: number;
  size: number;
}

interface SessionIndexFile {
  version: 1;
  entries: SessionIndexEntry[];
}

export async function loadSessionIndex(dataDir: string): Promise<Map<string, SessionIndexEntry>> {
  try {
    const text = await readFile(sessionIndexPath(dataDir), "utf8");
    const parsed = JSON.parse(text) as Partial<SessionIndexFile>;
    const entries = Array.isArray(parsed.entries) ? parsed.entries.filter(isSessionIndexEntry) : [];
    return new Map(entries.map((entry) => [entry.filePath, entry]));
  } catch (error: any) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return new Map();
    throw error;
  }
}

export async function saveSessionIndex(dataDir: string, entries: Iterable<SessionIndexEntry>): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const sorted = [...entries].sort((a, b) => a.filePath.localeCompare(b.filePath));
  const payload: SessionIndexFile = { version: 1, entries: sorted };
  await writeFile(sessionIndexPath(dataDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export function sessionIndexPath(dataDir: string): string {
  return join(dataDir, "session-index.json");
}

function isSessionIndexEntry(value: unknown): value is SessionIndexEntry {
  const entry = value as Partial<SessionIndexEntry>;
  return Boolean(
    entry &&
    typeof entry.id === "string" &&
    typeof entry.cwd === "string" &&
    typeof entry.updatedAt === "number" &&
    entry.status === "completed" &&
    typeof entry.filePath === "string" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.size === "number"
  );
}
