# Codex Bridge Runtime Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex Web bridge reliable enough for real agent tasks by adding a real Codex smoke path, approval APIs, durable event/job storage, and workspace-scoped thread indexes.

**Architecture:** Keep the current Node/TypeScript backend and Codex app-server JSON-RPC bridge. Add a small persistence boundary under `src/persistence`, route all event/job writes through that boundary, expose approval endpoints for Codex server-initiated requests, and add smoke scripts that validate live `thread/start` + `turn/start` event flow against a local Codex app-server.

**Tech Stack:** Node.js, TypeScript, Express, ws, Vitest, JSONL persistence, Codex `app-server` JSON-RPC.

---

## File Structure

- Modify `src/events/event-store.ts`: split current in-memory logic from storage concerns and accept a persistence adapter.
- Create `src/persistence/jsonl-store.ts`: append/read compact JSONL files for bridge events and turn jobs.
- Create `tests/jsonl-store.test.ts`: prove durable append/read/reload behavior.
- Modify `src/codex/codex-bridge.ts`: expose pending approval lifecycle and normalize approval response calls.
- Modify `src/http/routes.ts`: add approval endpoints and workspace endpoints.
- Modify `src/http/ws.ts`: accept browser approval commands over WebSocket.
- Modify `src/server.ts`: no architecture change, only route dependency updates if needed.
- Create `scripts/smoke-live-codex.ts`: live smoke command that creates a thread, starts a low-risk turn, waits for `turn/completed`, and prints the event sequence.
- Modify `package.json`: add `smoke:codex` script.
- Create `tests/approval-routes.test.ts`: route-level approval behavior.
- Create `tests/workspaces.test.ts`: workspace grouping from thread list data.
- Create `tests/live-smoke-contract.test.ts`: contract-test the smoke script against a fake bridge/client without real model calls.

## Task 1: JSONL Persistence Adapter

**Files:**
- Create: `src/persistence/jsonl-store.ts`
- Modify: `src/events/event-store.ts`
- Test: `tests/jsonl-store.test.ts`
- Test: `tests/event-store.test.ts`

- [ ] **Step 1: Write failing JSONL persistence tests**

Add `tests/jsonl-store.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { JsonlStore } from "../src/persistence/jsonl-store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("JsonlStore", () => {
  test("appends and reloads events and turns", async () => {
    const dir = await mkdtemp(join(tmpdir(), "bridge-jsonl-"));
    tempDirs.push(dir);
    const store = new JsonlStore(dir);

    await store.appendEvent({ seq: 1, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: { text: "hello" } });
    await store.upsertTurn({ threadId: "thread-1", turnId: "turn-1", status: "running", startedAt: "2026-05-28T00:00:01.000Z" });

    const reloaded = new JsonlStore(dir);
    await expect(reloaded.readEvents()).resolves.toEqual([
      { seq: 1, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: { text: "hello" } }
    ]);
    await expect(reloaded.readTurns()).resolves.toEqual([
      { threadId: "thread-1", turnId: "turn-1", status: "running", startedAt: "2026-05-28T00:00:01.000Z" }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- tests/jsonl-store.test.ts
```

Expected: FAIL because `src/persistence/jsonl-store.ts` does not exist.

- [ ] **Step 3: Implement `JsonlStore`**

Implement `src/persistence/jsonl-store.ts`:

```ts
import { mkdir, readFile, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BridgeEvent, TurnJob } from "../events/event-store.js";

export class JsonlStore {
  constructor(private readonly dataDir: string) {}

  async appendEvent(event: BridgeEvent): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await appendFile(join(this.dataDir, "events.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
  }

  async upsertTurn(turn: TurnJob): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const turns = await this.readTurns();
    const next = turns.filter((existing) => !(existing.threadId === turn.threadId && existing.turnId === turn.turnId));
    next.push(turn);
    await writeFile(join(this.dataDir, "turns.jsonl"), next.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
  }

  async readEvents(): Promise<BridgeEvent[]> {
    return readJsonl<BridgeEvent>(join(this.dataDir, "events.jsonl"));
  }

  async readTurns(): Promise<TurnJob[]> {
    return readJsonl<TurnJob>(join(this.dataDir, "turns.jsonl"));
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    const text = await readFile(path, "utf8");
    return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}
```

- [ ] **Step 4: Run JSONL test to verify GREEN**

Run:

```powershell
npm test -- tests/jsonl-store.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add persistence integration to EventStore**

Update `src/events/event-store.ts` constructor:

```ts
export interface EventPersistence {
  appendEvent(event: BridgeEvent): Promise<void>;
  upsertTurn(turn: TurnJob): Promise<void>;
  readEvents(): Promise<BridgeEvent[]>;
  readTurns(): Promise<TurnJob[]>;
}

export class EventStore {
  constructor(private readonly persistence?: EventPersistence) {}

  async load(): Promise<void> {
    if (!this.persistence) return;
    const events = await this.persistence.readEvents();
    const turns = await this.persistence.readTurns();
    // restore arrays/maps and nextSeq = max(seq)+1
  }
}
```

Keep `append`, `recordTurnStart`, and `recordTurnComplete` synchronous for existing callers, but fire-and-log persistence writes internally. Do not block WebSocket broadcasting on disk I/O.

- [ ] **Step 6: Extend `tests/event-store.test.ts`**

Add:

```ts
test("loads persisted events and turns", async () => {
  const persistence = {
    appendEvent: vi.fn(async () => {}),
    upsertTurn: vi.fn(async () => {}),
    readEvents: vi.fn(async () => [{ seq: 7, type: "note", createdAt: "2026-05-28T00:00:00.000Z", payload: {} }]),
    readTurns: vi.fn(async () => [{ threadId: "thread-1", turnId: "turn-1", status: "running", startedAt: "2026-05-28T00:00:01.000Z" }])
  };
  const store = new EventStore(persistence);
  await store.load();
  expect(store.list().map((event) => event.seq)).toEqual([7]);
  expect(store.append({ type: "later", payload: {} }).seq).toBe(8);
  expect(store.getRunningTurns()).toHaveLength(1);
});
```

- [ ] **Step 7: Run event tests**

Run:

```powershell
npm test -- tests/event-store.test.ts tests/jsonl-store.test.ts
```

Expected: PASS.

## Task 2: Approval API For Codex Server Requests

**Files:**
- Modify: `src/codex/codex-bridge.ts`
- Modify: `src/http/routes.ts`
- Modify: `src/http/ws.ts`
- Test: `tests/codex-bridge.test.ts`
- Test: `tests/approval-routes.test.ts`

- [ ] **Step 1: Add failing bridge approval tests**

Extend `tests/codex-bridge.test.ts`:

```ts
test("stores, approves, and rejects server requests", () => {
  const client = fakeClient();
  const store = new EventStore();
  const bridge = new CodexBridge(client as any, store);

  client.emitServerRequest({ method: "item/commandExecution/requestApproval", id: 42, params: { threadId: "thread-1" } });
  expect(bridge.getPendingServerRequests()).toEqual([
    { method: "item/commandExecution/requestApproval", id: 42, params: { threadId: "thread-1" } }
  ]);

  bridge.approveServerRequest(42, { decision: "approved" });
  expect(client.respond).toHaveBeenCalledWith(42, { decision: "approved" });
  expect(bridge.getPendingServerRequests()).toEqual([]);

  client.emitServerRequest({ method: "item/fileChange/requestApproval", id: 43, params: { threadId: "thread-1" } });
  bridge.rejectServerRequest(43, "Denied from web");
  expect(client.reject).toHaveBeenCalledWith(43, -32000, "Denied from web");
});
```

- [ ] **Step 2: Run bridge test to verify current behavior**

Run:

```powershell
npm test -- tests/codex-bridge.test.ts
```

Expected: PASS if existing methods already satisfy this; otherwise FAIL and implement the missing behavior.

- [ ] **Step 3: Write failing route tests**

Create `tests/approval-routes.test.ts`:

```ts
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAppServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { EventStore } from "../src/events/event-store.js";

const servers: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => Promise.all(servers.splice(0).map((server) => server.close())));

describe("approval routes", () => {
  test("lists pending requests and approves/rejects them", async () => {
    const bridge = {
      listThreads: vi.fn(), startThread: vi.fn(), resumeThread: vi.fn(), readThread: vi.fn(),
      rollbackThread: vi.fn(), startTurn: vi.fn(), interruptTurn: vi.fn(), steerTurn: vi.fn(),
      listSkills: vi.fn(), listPlugins: vi.fn(), listMcpServers: vi.fn(), readConfig: vi.fn(),
      getPendingServerRequests: vi.fn(() => [{ id: 42, method: "item/commandExecution/requestApproval", params: {} }]),
      approveServerRequest: vi.fn(),
      rejectServerRequest: vi.fn()
    };
    const baseUrl = await start(bridge);

    const pending = await json(`${baseUrl}/api/approvals`);
    expect(pending.data).toHaveLength(1);

    await json(`${baseUrl}/api/approvals/42/approve`, { method: "POST", body: { decision: "approved" } });
    await json(`${baseUrl}/api/approvals/42/reject`, { method: "POST", body: { message: "no" } });

    expect(bridge.approveServerRequest).toHaveBeenCalledWith("42", { decision: "approved" });
    expect(bridge.rejectServerRequest).toHaveBeenCalledWith("42", "no");
  });
});

async function start(bridge: any): Promise<string> {
  const { app, attachWebSocket } = createAppServer({
    config: loadConfig({}),
    bridge,
    events: new EventStore(),
    status: () => ({ connected: true })
  });
  const server = createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
  return `http://127.0.0.1:${port}`;
}

async function json(url: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  expect(response.status).toBeLessThan(500);
  return response.json();
}
```

- [ ] **Step 4: Run route test to verify RED**

Run:

```powershell
npm test -- tests/approval-routes.test.ts
```

Expected: FAIL because `/api/approvals` routes do not exist.

- [ ] **Step 5: Implement approval routes**

Modify `src/http/routes.ts` `BridgeLike`:

```ts
approveServerRequest(requestId: string | number, result: unknown): void;
rejectServerRequest(requestId: string | number, message: string): void;
```

Add routes:

```ts
router.get("/api/approvals", (_req, res) => ok(res, deps.bridge.getPendingServerRequests()));

router.post("/api/approvals/:requestId/approve", (req, res) => {
  deps.bridge.approveServerRequest(param(req.params.requestId), req.body ?? {});
  ok(res, {});
});

router.post("/api/approvals/:requestId/reject", (req, res) => {
  deps.bridge.rejectServerRequest(param(req.params.requestId), String(req.body?.message ?? "Rejected by user"));
  ok(res, {});
});
```

- [ ] **Step 6: Add WebSocket approval commands**

Modify `src/http/ws.ts` so clients can send:

```json
{ "type": "approval.approve", "requestId": "42", "result": { "decision": "approved" } }
{ "type": "approval.reject", "requestId": "42", "message": "no" }
```

This requires passing `bridge` into `attachBrowserWebSocket`. Update `src/server.ts` accordingly.

- [ ] **Step 7: Run approval tests**

Run:

```powershell
npm test -- tests/codex-bridge.test.ts tests/approval-routes.test.ts tests/http-routes.test.ts
```

Expected: PASS.

## Task 3: Workspace-Scoped Thread Index API

**Files:**
- Create: `src/workspaces/workspace-index.ts`
- Modify: `src/http/routes.ts`
- Test: `tests/workspaces.test.ts`

- [ ] **Step 1: Write failing workspace grouping tests**

Create `tests/workspaces.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { groupThreadsByWorkspace } from "../src/workspaces/workspace-index.js";

describe("groupThreadsByWorkspace", () => {
  test("groups threads by cwd and sorts workspaces and threads by updatedAt desc", () => {
    const result = groupThreadsByWorkspace([
      { id: "a", cwd: "D:\\repo-a", preview: "old", updatedAt: 10, status: "notLoaded" },
      { id: "b", cwd: "D:\\repo-b", preview: "new", updatedAt: 30, status: "running" },
      { id: "c", cwd: "D:\\repo-a", preview: "latest a", updatedAt: 20, status: "completed" }
    ]);

    expect(result).toEqual([
      { cwd: "D:\\repo-b", name: "repo-b", updatedAt: 30, runningCount: 1, threads: [expect.objectContaining({ id: "b" })] },
      { cwd: "D:\\repo-a", name: "repo-a", updatedAt: 20, runningCount: 0, threads: [expect.objectContaining({ id: "c" }), expect.objectContaining({ id: "a" })] }
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- tests/workspaces.test.ts
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement workspace grouping**

Create `src/workspaces/workspace-index.ts`:

```ts
import { basename } from "node:path";

export interface ThreadSummaryLike {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
  status: string;
}

export interface WorkspaceGroup {
  cwd: string;
  name: string;
  updatedAt: number;
  runningCount: number;
  threads: ThreadSummaryLike[];
}

export function groupThreadsByWorkspace(threads: ThreadSummaryLike[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();
  for (const thread of threads) {
    const group = groups.get(thread.cwd) ?? { cwd: thread.cwd, name: basename(thread.cwd), updatedAt: 0, runningCount: 0, threads: [] };
    group.threads.push(thread);
    group.updatedAt = Math.max(group.updatedAt, thread.updatedAt);
    group.runningCount += thread.status === "running" ? 1 : 0;
    groups.set(thread.cwd, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, threads: group.threads.sort((a, b) => b.updatedAt - a.updatedAt) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
```

- [ ] **Step 4: Add `/api/workspaces` route**

Modify `src/http/routes.ts`:

```ts
router.get("/api/workspaces", asyncHandler(async (_req, res) => {
  const result = await deps.bridge.listThreads({ });
  const threads = Array.isArray((result as any).data) ? (result as any).data : [];
  ok(res, groupThreadsByWorkspace(threads));
}));
```

- [ ] **Step 5: Update HTTP route tests**

Modify `tests/http-routes.test.ts` to assert:

```ts
await requestJson(`${baseUrl}/api/workspaces`);
expect(bridge.listThreads).toHaveBeenCalledWith({});
```

- [ ] **Step 6: Run workspace tests**

Run:

```powershell
npm test -- tests/workspaces.test.ts tests/http-routes.test.ts
```

Expected: PASS.

## Task 4: Live Codex Smoke Script

**Files:**
- Create: `scripts/smoke-live-codex.ts`
- Modify: `package.json`
- Test: `tests/live-smoke-contract.test.ts`

- [ ] **Step 1: Write smoke contract test**

Create `tests/live-smoke-contract.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { waitForTurnCompletion } from "../scripts/smoke-live-codex.js";
import { EventStore } from "../src/events/event-store.js";

describe("waitForTurnCompletion", () => {
  test("resolves when matching turn completes", async () => {
    const events = new EventStore();
    const done = waitForTurnCompletion(events, "thread-1", "turn-1", 1000);
    events.append({ type: "codex.turn/completed", threadId: "thread-1", turnId: "turn-1", payload: {} });
    await expect(done).resolves.toBeUndefined();
  });

  test("rejects on timeout", async () => {
    await expect(waitForTurnCompletion(new EventStore(), "thread-1", "turn-1", 1)).rejects.toThrow("Timed out waiting for turn completion");
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm test -- tests/live-smoke-contract.test.ts
```

Expected: FAIL because script does not exist.

- [ ] **Step 3: Implement live smoke script**

Create `scripts/smoke-live-codex.ts`:

```ts
import "dotenv/config";
import { loadConfig } from "../src/config.js";
import { EventStore } from "../src/events/event-store.js";
import { CodexAppServerManager } from "../src/codex/app-server-manager.js";
import { CodexJsonRpcClient } from "../src/codex/json-rpc-client.js";
import { CodexBridge } from "../src/codex/codex-bridge.js";

export async function waitForTurnCompletion(events: EventStore, threadId: string, turnId: string, timeoutMs: number): Promise<void> {
  if (events.list({ threadId }).some((event) => event.turnId === turnId && event.type === "codex.turn/completed")) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for turn completion"));
    }, timeoutMs);
    const unsubscribe = events.subscribe((event) => {
      if (event.threadId === threadId && event.turnId === turnId && event.type === "codex.turn/completed") {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const manager = new CodexAppServerManager(config);
  const endpoint = await manager.ensureRunning();
  const client = new CodexJsonRpcClient({ url: endpoint.url, token: endpoint.token, experimentalApi: config.enableExperimentalCodexApi });
  await client.connect();
  const events = new EventStore();
  const bridge = new CodexBridge(client, events);

  const threadResponse = await bridge.startThread({ cwd: process.cwd() }) as any;
  const threadId = threadResponse.thread.id;
  const turnResponse = await bridge.startTurn(threadId, "Reply with exactly: codex web bridge smoke ok") as any;
  const turnId = turnResponse.turn.id;
  await waitForTurnCompletion(events, threadId, turnId, 120_000);
  console.log(JSON.stringify({ ok: true, threadId, turnId, eventTypes: events.list({ threadId }).map((event) => event.type) }, null, 2));
  client.close();
  await manager.shutdown();
}

if (process.argv[1]?.endsWith("smoke-live-codex.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Add package script**

Modify `package.json`:

```json
"smoke:codex": "tsx scripts/smoke-live-codex.ts"
```

- [ ] **Step 5: Run contract test**

Run:

```powershell
npm test -- tests/live-smoke-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run live smoke manually**

Run:

```powershell
npm run smoke:codex
```

Expected: JSON output with `ok: true`, a `threadId`, a `turnId`, and event types including `codex.turn/started` and `codex.turn/completed`.

If it fails due to missing auth, preserve the failure output and do not modify auth files.

## Task 5: Wire Persistence Into Runtime

**Files:**
- Modify: `src/index.ts`
- Modify: `.env.example`
- Test: existing full suite

- [ ] **Step 1: Modify runtime event store creation**

In `src/index.ts`, replace:

```ts
const events = new EventStore();
```

with:

```ts
const events = new EventStore(new JsonlStore(config.dataDir));
await events.load();
```

This requires moving `loadConfig()` before `EventStore` construction.

- [ ] **Step 2: Update `.env.example` comments**

Add:

```env
# Bridge state is stored here: events.jsonl, turns.jsonl, codex-ws-token.txt.
DATA_DIR=.data
```

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm test
npm run build
```

Expected: both pass.

- [ ] **Step 4: Restart bridge and smoke HTTP state**

Run:

```powershell
$env:HOST='127.0.0.1'
$env:PORT='49380'
npm run dev
```

In a second shell:

```powershell
Invoke-RestMethod http://127.0.0.1:49380/health
Invoke-RestMethod http://127.0.0.1:49380/api/status
Invoke-RestMethod http://127.0.0.1:49380/api/events
```

Expected: health `ok: true`, status `connected: true`, events returns a JSON array under `data`.

## Self-Review

- Spec coverage: The plan covers real Codex turn smoke testing, approval APIs, event/job persistence, workspace grouping, runtime wiring, and verification.
- Placeholder scan: No `TBD`, `TODO`, or vague “handle later” instructions remain.
- Type consistency: `JsonlStore`, `EventStore`, `CodexBridge`, approval route names, and workspace grouping types are consistent across tasks.
- Scope check: UI is intentionally excluded. This plan hardens the backend bridge only.
