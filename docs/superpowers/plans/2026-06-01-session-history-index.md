# Session History Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache local Codex rollout summaries in a persistent index so `/api/threads` does not rescan every history file on each refresh.

**Architecture:** Add a dedicated session-index module under `src/codex/` that reads and writes a JSON index file in `.data`. `listLocalCodexThreads()` becomes index-first: load cached summaries, stat discovered rollout files, parse only new or changed files, then merge and persist. Keep the current bounded read concurrency as a fallback safety rail, not the primary mechanism.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing Express routes, Vitest.

---

### Task 1: Lock in index behavior with failing tests

**Files:**
- Create: `tests/session-history-index.test.ts`
- Modify: `tests/session-history-concurrency.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { listLocalCodexThreads } from "../src/codex/session-history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("listLocalCodexThreads index", () => {
  test("reuses cached summaries for unchanged rollout files", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-"));
  const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
  tempDirs.push(codexHome, dataDir);
  const sessionDir = join(codexHome, "sessions", "2026", "06", "01");
  await mkdir(sessionDir, { recursive: true });
  const filePath = join(sessionDir, "rollout-2026-06-01T00-00-00-019e70f7-3103-7e52-b519-000000000001.jsonl");
  await writeFile(filePath, [
    JSON.stringify({
      timestamp: "2026-06-01T00:00:00.000Z",
      type: "session_meta",
      payload: { id: "019e70f7-3103-7e52-b519-000000000001", cwd: "D:\\codex-web", timestamp: "2026-06-01T00:00:00.000Z" }
    }),
    JSON.stringify({
      timestamp: "2026-06-01T00:00:01.000Z",
      type: "event_msg",
      payload: { type: "user_message", message: "hello" }
    })
  ].join("\\n"), "utf8");

  await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
  await rm(filePath, { force: true });
  const threads = await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });

  expect(threads).toHaveLength(0);
  });

  test("updates the persisted index after parsing rollout files", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-index-"));
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-index-data-"));
    tempDirs.push(codexHome, dataDir);
    const sessionDir = join(codexHome, "sessions", "2026", "06", "01");
    await mkdir(sessionDir, { recursive: true });
    const filePath = join(sessionDir, "rollout-2026-06-01T00-00-00-019e70f7-3103-7e52-b519-000000000001.jsonl");
    await writeFile(filePath, [
      JSON.stringify({
        timestamp: "2026-06-01T00:00:00.000Z",
        type: "session_meta",
        payload: { id: "019e70f7-3103-7e52-b519-000000000001", cwd: "D:\\codex-web", timestamp: "2026-06-01T00:00:00.000Z" }
      }),
      JSON.stringify({
        timestamp: "2026-06-01T00:00:01.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "hello" }
      })
    ].join("\\n"), "utf8");

    await listLocalCodexThreads({ codexHome, indexDataDir: dataDir, cwd: "D:\\codex-web", limit: 50 });
    const index = JSON.parse(await readFile(join(dataDir, "session-index.json"), "utf8"));

    expect(index.entries[0]).toEqual(expect.objectContaining({
      id: "019e70f7-3103-7e52-b519-000000000001",
      cwd: "D:\\codex-web",
      preview: "hello",
      filePath
    }));
  });
});

function activeRequestCount(): number {
  return ((process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.() ?? []).length;
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npx vitest run tests/session-history-index.test.ts tests/session-history-concurrency.test.ts`
Expected: `session-history-index.test.ts` fails because `indexDataDir` and `session-index.json` support do not exist yet.

### Task 2: Implement the session index store and wire it into rollout loading

**Files:**
- Create: `src/codex/session-history-index.ts`
- Modify: `src/codex/session-history.ts`

- [ ] **Step 1: Write the minimal implementation**

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SessionIndexEntry {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
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
  await writeFile(sessionIndexPath(dataDir), `${JSON.stringify({ version: 1, entries: sorted }, null, 2)}\n`, "utf8");
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
    typeof entry.filePath === "string" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.size === "number"
  );
}
```

- [ ] **Step 2: Run the focused tests until green**

Run:
`npx vitest run tests/session-history-index.test.ts tests/session-history-concurrency.test.ts`

Expected:
- unchanged rollout files are reused from the index,
- changed files are re-parsed,
- deleted files are dropped,
- concurrency stays bounded.

### Task 3: Verify the full app path

**Files:**
- None expected unless test fallout reveals a missing import or type mismatch

- [ ] **Step 1: Run the full verification**

Run:
`npm test`
`npm run build`

Expected:
- all tests pass,
- production build succeeds,
- no new warnings beyond the existing Vite chunk-size notice.

- [ ] **Step 2: Restart the dev service and confirm it stays up**

Run:
`npm run dev:restart`

Then verify:
`Invoke-RestMethod http://127.0.0.1:49380/health`
`Invoke-WebRequest http://127.0.0.1:49381/`

Expected:
- backend health returns `{ ok: true }`,
- frontend returns HTTP 200,
- no new `EMFILE` errors appear in `.logs/dev-backend.err.log`.
