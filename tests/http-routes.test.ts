# Codex App-Server Capability Research

Date: 2026-05-29

Scope: verify what the Codex Web UI should expose by reading the app-server JSON-RPC schema used by this project, not by inferring from the Codex TUI.

## Sources

- Local project bridge:
  - `src/codex/codex-bridge.ts`
  - `src/codex/json-rpc-client.ts`
  - `src/http/routes.ts`
- Generated app-server schema from installed Codex CLI:
  - command: `codex app-server generate-ts --out $env:TEMP/codex-app-server-schema`
  - installed package: `@openai/codex@0.134.0`
  - schema path: `%TEMP%/codex-app-server-schema`

The generated schema is the main source of truth for parameter names in this document.

## Current Bridge Surface

The current bridge already uses these app-server methods:

- `thread/list`
- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/rollback`
- `turn/start`
- `turn/interrupt`
- `turn/steer`
- `skills/list`
- `plugin/list`
- `mcpServerStatus/list`
- `config/read`

Current `thread/start` passes through:

- `cwd`
- `model`
- `modelProvider`
- `approvalPolicy`
- `sandbox`

Current `turn/start` passes:

- `threadId`
- `input`
- arbitrary `overrides`

The arbitrary `overrides` path can carry real app-server fields, but the frontend should not invent field names. It should use the schema names below.

## Thread And Turn Overrides

### `thread/start`

Generated `v2/ThreadStartParams` supports:

- `model?: string`
- `modelProvider?: string`
- `serviceTier?: string`
- `cwd?: string`
- `approvalPolicy?: AskForApproval`
- `approvalsReviewer?: ApprovalsReviewer`
- `sandbox?: SandboxMode`
- `config?: Record<string, JsonValue>`
- `serviceName?: string`
- `baseInstructions?: string`
- `developerInstructions?: string`
- `personality?: Personality`
- `ephemeral?: boolean`
- `sessionStartSource?: "startup" | "clear"`
- `threadSource?: "user" | "subagent" | "memory_consolidation"`

### `turn/start`

Generated `v2/TurnStartParams` supports:

- `threadId: string`
- `input: UserInput[]`
- `cwd?: string`
- `approvalPolicy?: AskForApproval`
- `approvalsReviewer?: ApprovalsReviewer`
- `sandboxPolicy?: SandboxPolicy`
- `model?: string`
- `serviceTier?: string`
- `effort?: ReasoningEffort`
- `summary?: ReasoningSummary`
- `personality?: Personality`
- `outputSchema?: JsonValue`

Important detail: `turn/start` uses `sandboxPolicy`, while `thread/start` uses legacy `sandbox`.

## Model Picker

App-server has a real model list method:

- `model/list`

Generated types:

- `ModelListParams`
  - `cursor?: string`
  - `limit?: number`
  - `includeHidden?: boolean`
- `ModelListResponse`
  - `data: Model[]`
  - `nextCursor: string | null`

Implementation implication:

- Do not hardcode the full model list.
- Add a bridge method and REST endpoint for `model/list`.
- UI can keep a small fallback list only for offline/error states, but real data should come from app-server.

There is also:

- `modelProvider/capabilities/read`

Its response includes:

- `namespaceTools`
- `imageGeneration`
- `webSearch`

This can inform capability badges later, but is not needed for the first picker.

## Reasoning Effort

Generated `ReasoningEffort` is:

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

Generated `ReasoningSummary` is:

- `auto`
- `concise`
- `detailed`
- `none`

Implementation implication:

- The UI labels can be Chinese:
  - `低` -> `low`
  - `中` -> `medium`
  - `高` -> `high`
  - `超高` -> `xhigh`
- We may also expose `minimal` and `none` later if needed.
- The field name for the turn override is `effort`, not `reasoningEffort`.

## Approval And Work Modes

### Approval policy

Generated `AskForApproval` is:

- `untrusted`
- `on-failure`
- `on-request`
- `never`
- granular object:
  - `sandbox_approval`
  - `rules`
  - `skill_approval`
  - `request_permissions`
  - `mcp_elicitations`

### Approval reviewer

Generated `ApprovalsReviewer` is:

- `user`
- `auto_review`
- `guardian_subagent`

Schema comment:

- `user` is the default.
- `auto_review` uses a prompted subagent to gather context and approve/deny by risk framework.

### Sandbox

Generated `SandboxMode` for `thread/start` is:

- `read-only`
- `workspace-write`
- `danger-full-access`

Generated `SandboxPolicy` for `turn/start` is:

- `{ type: "dangerFullAccess" }`
- `{ type: "readOnly", networkAccess: boolean }`
- `{ type: "externalSandbox", networkAccess: NetworkAccess }`
- `{ type: "workspaceWrite", writableRoots: string[], networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean }`

Implementation implication for the requested mode menu:

- `默认`: send no override.
- `自动审查`: set `approvalsReviewer: "auto_review"`; keep sandbox/approval policy unchanged unless user also changes access.
- `完全访问权限`: set sandbox to full access.
  - On `thread/start`: `sandbox: "danger-full-access"`.
  - On `turn/start`: `sandboxPolicy: { type: "dangerFullAccess" }`.
- `YOLO`: align with the Codex CLI command commonly used by the user:
  - `codex --dangerously-bypass-approvals-and-sandbox`
  - app-server mapping:
    - `approvalPolicy: "never"`
    - full sandbox as above
    - optionally auto-approve any still-emitted server request in the bridge.
  - Because `YOLO` bypasses safety prompts, it should remain visibly distinct in UI.

## Plan Mode

Generated schema has:

- `CollaborationMode`
- `ModeKind = "plan" | "default"`
- `ThreadSettings.collaborationMode`
- plan notifications/items:
  - `turn/plan/updated`
  - `ThreadItem` variant `{ type: "plan", ... }`
  - `TurnPlanStep`

However, `thread/start` and `turn/start` do not expose a direct `collaborationMode` field. The likely path is config or settings, but this project does not currently write config or thread settings.

Implementation implication:

- Do not expose Plan as a standalone composer toggle in the current UI.
- The next design pass should map `/` slash commands from Codex TUI/client behavior, then route `/plan` through that command surface if supported.
- Until the slash command bridge is designed, do not claim Plan is connected.

## Goal Mode

Goal is real, but it is not a `turn/start` mode.

Generated client methods:

- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`

Generated `ThreadGoalSetParams`:

- `threadId: string`
- `objective?: string`
- `status?: ThreadGoalStatus`
- `tokenBudget?: number`

Implementation implication:

- Do not expose Goal as a standalone composer toggle in the current UI.
- Goal should be revisited together with slash command mapping and native client behavior, not as a speculative one-off UI control.

## File And Image Input

Generated `UserInput` supports:

- `{ type: "text", text, text_elements: [] }`
- `{ type: "image", url, detail? }`
- `{ type: "localImage", path, detail? }`
- `{ type: "skill", name, path }`
- `{ type: "mention", name, path }`

Implementation implication:

- Image upload preview is compatible with app-server.
- For local browser upload, the bridge needs to persist uploaded images to a local data directory, then send `localImage` with the saved path.
- If later supporting remote URLs, use `image`.
- The existing bridge only sends text; `textInput()` must be generalized to `UserInput[]`.

## Quick Project Creation

This is a Codex Web feature, not app-server behavior.

Requested behavior:

- create a directory under `D:\codex-web`
- default names: `project-1`, `project-2`, ...
- add the new directory as a project
- expand/select it

Suggested icon:

- Do not use lightning.
- Use a creation-oriented icon such as `SquarePlus`, `FolderPlus`, or `PackagePlus`.
- Since the normal add-project button already uses `FolderPlus`, `SquarePlus` or `PackagePlus` will better distinguish quick creation from folder picker.

## Required Bridge Additions

Recommended backend additions before connecting the new composer controls:

- `CodexBridge.listModels(input?: { cursor?: string; limit?: number; includeHidden?: boolean })`
  - app-server: `model/list`
- `CodexBridge.readModelProviderCapabilities()`
  - app-server: `modelProvider/capabilities/read`
- `CodexBridge.setThreadGoal(input)`
  - app-server: `thread/goal/set`
- `CodexBridge.getThreadGoal(threadId)`
  - app-server: `thread/goal/get`
- `CodexBridge.clearThreadGoal(threadId)`
  - app-server: `thread/goal/clear`
- `CodexBridge.startTurnItems(threadId, input: UserInput[], overrides)`
  - or change existing `startTurn` to accept `UserInput[]`
- upload endpoint for images:
  - save file under `.data/uploads/...`
  - return local absolute path and preview URL

## UI Implementation Notes

Composer controls should map to real fields:

- model dropdown:
  - data from `model/list`
  - send as `model` on `thread/start` or `turn/start`
- effort dropdown:
  - send as `effort`
- work mode:
  - default: no override
  - auto review: `approvalsReviewer: "auto_review"`
  - full access: `sandbox` / `sandboxPolicy`
  - YOLO: `approvalPolicy: "never"` plus full access; bridge auto-approval can be added if needed
- image upload:
  - preview in UI
  - send `localImage` path after backend upload
- Plan and Goal:
  - not part of the current composer controls
  - revisit after slash command mapping is designed

# Codex Web Backend Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Codex web bridge backend reliable enough for a remote Web UI: background turn status survives browser disconnects, REST/WS surfaces expose consistent snapshots, and notifications can be plugged in without changing bridge logic.

**Architecture:** Keep the current Express + ws + JSONL architecture. Add focused service modules around the existing `EventStore`: a task snapshot query layer, a notifier abstraction, and request validation at HTTP boundaries. Do not add a database or frontend in this phase.

**Tech Stack:** Node.js, TypeScript, Express, `ws`, Zod, Vitest, JSONL persistence.

---

## File Structure

- Modify `src/events/event-store.ts`: expose all known turn jobs and keep existing append/subscribe behavior unchanged.
- Create `src/tasks/task-index.ts`: convert `EventStore` turn jobs into stable API task summaries.
- Create `tests/task-index.test.ts`: verify task grouping/status ordering.
- Modify `src/http/routes.ts`: add Zod validation and task endpoints.
- Modify `tests/http-routes.test.ts`: cover task endpoints and validation errors.
- Modify `src/http/ws.ts`: send an initial task/event snapshot on connection and keep approval messages guarded.
- Modify `tests/ws.test.ts`: cover WebSocket hello snapshot and invalid message handling.
- Create `src/notifications/notifier.ts`: define notifier interface and no-op implementation.
- Create `src/notifications/http-notifier.ts`: optional HTTP notifier using env/config input.
- Modify `src/config.ts`: add optional notification environment variables.
- Modify `src/server.ts`: wire notifier to event completion/failure/approval events.
- Create `tests/notifier.test.ts`: verify notification trigger payloads without real network calls.
- Modify `scripts/smoke-live-codex.ts`: always close the JSON-RPC client and manager in `finally`.
- Modify `tests/live-smoke-contract.test.ts`: verify cleanup runs on completion timeout.

---

### Task 1: Task Snapshot Index

**Files:**
- Modify: `src/events/event-store.ts`
- Create: `src/tasks/task-index.ts`
- Create: `tests/task-index.test.ts`

- [ ] **Step 1: Write the failing task index test**

Create `tests/task-index.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { listTaskSummaries } from "../src/tasks/task-index.js";

describe("listTaskSummaries", () => {
  test("lists turn jobs sorted by latest activity first with event counts", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-a", "turn-old");
    events.append({ type: "codex.item/started", threadId: "thread-a", turnId: "turn-old", payload: {} });
    events.recordTurnComplete("thread-a", "turn-old", "completed");
    events.recordTurnStart("thread-b", "turn-new");

    const result = listTaskSummaries(events);

    expect(result).toEqual([
      expect.objectContaining({
        threadId: "thread-b",
        turnId: "turn-new",
        status: "running",
        eventCount: 2
      }),
      expect.objectContaining({
        threadId: "thread-a",
        turnId: "turn-old",
        status: "completed",
        eventCount: 4
      })
    ]);
  });

  test("can filter by thread id", () => {
    const events = new EventStore();
    events.recordTurnStart("thread-a", "turn-a");
    events.recordTurnStart("thread-b", "turn-b");

    expect(listTaskSummaries(events, { threadId: "thread-a" })).toEqual([
      expect.objectContaining({ threadId: "thread-a", turnId: "turn-a" })
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/task-index.test.ts --run
```

Expected: FAIL because `src/tasks/task-index.ts` does not exist.

- [ ] **Step 3: Implement task snapshots**

In `src/events/event-store.ts`, add:

```ts
  listTurns(): TurnJob[] {
    return [...this.turns.values()];
  }
```

Create `src/tasks/task-index.ts`:

```ts
import type { EventStore, TurnJob, TurnJobStatus } from "../events/event-store.js";

export interface TaskSummary {
  threadId: string;
  turnId: string;
  status: TurnJobStatus;
  startedAt: string;
  completedAt?: string;
  lastEventAt: string;
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
    .sort((a, b) => Date.parse(b.lastEventAt) - Date.parse(a.lastEventAt));
}

function toTaskSummary(events: EventStore, turn: TurnJob): TaskSummary {
  const related = events.list({ threadId: turn.threadId }).filter((event) => event.turnId === turn.turnId);
  const lastEvent = related.at(-1);
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    status: turn.status,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    lastEventAt: lastEvent?.createdAt ?? turn.completedAt ?? turn.startedAt,
    eventCount: related.length
  };
}
```

- [ ] **Step 4: Run task index test**

Run:

```bash
npm test -- tests/task-index.test.ts --run
```

Expected: PASS.

---

### Task 2: REST Task Endpoints and Input Validation

**Files:**
- Modify: `src/http/routes.ts`
- Modify: `tests/http-routes.test.ts`

- [ ] **Step 1: Write failing HTTP route tests**

Extend `tests/http-routes.test.ts` with tests that:

```ts
test("GET /api/tasks returns task summaries", async () => {
  events.recordTurnStart("thread-1", "turn-1");
  const response = await request(app).get("/api/tasks").expect(200);
  expect(response.body.data).toEqual([
    expect.objectContaining({ threadId: "thread-1", turnId: "turn-1", status: "running" })
  ]);
});

test("POST /api/threads/:threadId/turns rejects empty text", async () => {
  const response = await request(app).post("/api/threads/thread-1/turns").send({ text: "" }).expect(400);
  expect(response.body).toEqual(expect.objectContaining({ ok: false }));
});
```

Use the existing test setup in the file; do not introduce supertest if the file already uses another request helper.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/http-routes.test.ts --run
```

Expected: FAIL because `/api/tasks` does not exist and empty turn text is accepted.

- [ ] **Step 3: Implement endpoints and validation**

In `src/http/routes.ts`:

```ts
import { z } from "zod";
import { listTaskSummaries } from "../tasks/task-index.js";
```

Add endpoint before `/api/threads`:

```ts
  router.get("/api/tasks", (req, res) => {
    ok(res, listTaskSummaries(deps.events, {
      threadId: stringQuery(req.query.threadId),
      status: turnStatusQuery(req.query.status)
    }));
  });
```

Replace raw turn start body parsing with:

```ts
const startTurnSchema = z.object({
  text: z.string().trim().min(1),
  overrides: z.record(z.unknown()).optional()
});
```

Use it in `/api/threads/:threadId/turns`:

```ts
  router.post("/api/threads/:threadId/turns", asyncHandler(async (req, res) => {
    const body = startTurnSchema.parse(req.body ?? {});
    ok(res, await deps.bridge.startTurn(param(req.params.threadId), body.text, body.overrides ?? {}));
  }));
```

Add helper:

```ts
function turnStatusQuery(value: unknown): "running" | "completed" | "failed" | "interrupted" | undefined {
  if (value === "running" || value === "completed" || value === "failed" || value === "interrupted") return value;
  return undefined;
}
```

Update error middleware to map `z.ZodError` to 400:

```ts
    if (error instanceof z.ZodError) {
      res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid request body", issues: error.issues } });
      return;
    }
```

- [ ] **Step 4: Run HTTP tests**

Run:

```bash
npm test -- tests/http-routes.test.ts --run
```

Expected: PASS.

---

### Task 3: WebSocket Initial Snapshot and Message Guarding

**Files:**
- Modify: `src/http/ws.ts`
- Create: `tests/ws.test.ts`

- [ ] **Step 1: Write failing WebSocket tests**

Create `tests/ws.test.ts` with a real HTTP server and `ws` client:

```ts
import { createServer } from "node:http";
import WebSocket from "ws";
import { afterEach, describe, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { attachBrowserWebSocket } from "../src/http/ws.js";

const servers: Array<{ close: () => void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

test("sends hello with initial events and tasks", async () => {
  const events = new EventStore();
  events.recordTurnStart("thread-1", "turn-1");
  const server = createServer();
  attachBrowserWebSocket(server, events);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");

  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  const first = await nextMessage(ws);
  ws.close();

  expect(first.type).toBe("hello");
  expect(first.events.length).toBeGreaterThan(0);
  expect(first.tasks).toEqual([expect.objectContaining({ threadId: "thread-1", turnId: "turn-1" })]);
});

test("ignores invalid JSON messages", async () => {
  const events = new EventStore();
  const bridge = { approveServerRequest: vi.fn(), rejectServerRequest: vi.fn() } as any;
  const server = createServer();
  attachBrowserWebSocket(server, events, bridge);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");

  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await nextMessage(ws);
  ws.send("{bad json");
  await new Promise((resolve) => setTimeout(resolve, 20));
  ws.close();

  expect(bridge.approveServerRequest).not.toHaveBeenCalled();
  expect(bridge.rejectServerRequest).not.toHaveBeenCalled();
});

function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString())));
    ws.once("error", reject);
  });
}
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/ws.test.ts --run
```

Expected: FAIL because hello does not contain snapshots.

- [ ] **Step 3: Implement snapshot and guarded parsing**

In `src/http/ws.ts`:

```ts
import { listTaskSummaries } from "../tasks/task-index.js";
```

Change hello send to:

```ts
    ws.send(JSON.stringify({
      type: "hello",
      events: events.list(),
      tasks: listTaskSummaries(events),
      pendingServerRequests: bridge?.getPendingServerRequests() ?? []
    }));
```

Change message handler to catch invalid JSON:

```ts
    ws.on("message", (data) => {
      if (!bridge) return;
      let message: any;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (message.type === "approval.approve") {
        bridge.approveServerRequest(String(message.requestId), message.result ?? {});
      }
      if (message.type === "approval.reject") {
        bridge.rejectServerRequest(String(message.requestId), String(message.message ?? "Rejected by user"));
      }
    });
```

- [ ] **Step 4: Run WebSocket tests**

Run:

```bash
npm test -- tests/ws.test.ts --run
```

Expected: PASS.

---

### Task 4: Notification Adapter and Event Triggers

**Files:**
- Create: `src/notifications/notifier.ts`
- Create: `src/notifications/http-notifier.ts`
- Modify: `src/config.ts`
- Modify: `src/server.ts`
- Create: `tests/notifier.test.ts`
- Modify: `tests/config.test.ts`

- [ ] **Step 1: Write failing notifier tests**

Create `tests/notifier.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { EventStore } from "../src/events/event-store.js";
import { attachEventNotifications, NullNotifier } from "../src/notifications/notifier.js";

describe("attachEventNotifications", () => {
  test("notifies when a turn completes", async () => {
    const events = new EventStore();
    const notifier = { notify: vi.fn(async () => undefined) };
    attachEventNotifications(events, notifier);

    events.recordTurnStart("thread-1", "turn-1");
    events.recordTurnComplete("thread-1", "turn-1", "completed");
    await Promise.resolve();

    expect(notifier.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: "turn.completed",
      title: "Codex task completed",
      threadId: "thread-1",
      turnId: "turn-1"
    }));
  });

  test("null notifier resolves without side effects", async () => {
    await expect(new NullNotifier().notify({ type: "turn.completed", title: "x" })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run notifier test to verify failure**

Run:

```bash
npm test -- tests/notifier.test.ts --run
```

Expected: FAIL because notifier module does not exist.

- [ ] **Step 3: Implement notifier module**

Create `src/notifications/notifier.ts`:

```ts
import type { EventStore, BridgeEvent } from "../events/event-store.js";

export interface NotificationMessage {
  type: "turn.completed" | "turn.failed" | "turn.interrupted" | "approval.required";
  title: string;
  message?: string;
  threadId?: string;
  turnId?: string;
  source?: string;
}

export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}

export class NullNotifier implements Notifier {
  async notify(_message: NotificationMessage): Promise<void> {}
}

export function attachEventNotifications(events: EventStore, notifier: Notifier): () => void {
  return events.subscribe((event) => {
    const message = notificationFromEvent(event);
    if (!message) return;
    void notifier.notify(message);
  });
}

function notificationFromEvent(event: BridgeEvent): NotificationMessage | undefined {
  if (event.type === "turn.completed") {
    const status = (event.payload as any)?.status;
    if (status === "failed") return base(event, "turn.failed", "Codex task failed");
    if (status === "interrupted") return base(event, "turn.interrupted", "Codex task interrupted");
    return base(event, "turn.completed", "Codex task completed");
  }
  if (event.type.startsWith("codex.request.")) {
    return {
      type: "approval.required",
      title: "Codex needs approval",
      message: event.type,
      source: "codex-web"
    };
  }
  return undefined;
}

function base(event: BridgeEvent, type: NotificationMessage["type"], title: string): NotificationMessage {
  return {
    type,
    title,
    threadId: event.threadId,
    turnId: event.turnId,
    source: "codex-web"
  };
}
```

- [ ] **Step 4: Implement optional HTTP notifier**

Create `src/notifications/http-notifier.ts`:

```ts
import type { Notifier, NotificationMessage } from "./notifier.js";

export interface HttpNotifierOptions {
  url: string;
  token?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  fetchFn?: typeof fetch;
}

export class HttpNotifier implements Notifier {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpNotifierOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async notify(message: NotificationMessage): Promise<void> {
    const response = await this.fetchFn(this.options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {})
      },
      body: JSON.stringify({
        target_type: this.options.targetType,
        target_id: this.options.targetId,
        title: message.title,
        message: message.message ?? `${message.type}${message.threadId ? ` thread=${message.threadId}` : ""}${message.turnId ? ` turn=${message.turnId}` : ""}`,
        source: this.options.source ?? message.source ?? "codex-web"
      })
    });
    if (!response.ok) {
      throw new Error(`Notification request failed with status ${response.status}`);
    }
  }
}
```

- [ ] **Step 5: Wire config and server**

In `src/config.ts`, add optional env fields:

```ts
notificationUrl: env.NOTIFY_URL,
notificationToken: env.NOTIFY_TOKEN,
notificationTargetType: env.NOTIFY_TARGET_TYPE,
notificationTargetId: env.NOTIFY_TARGET_ID,
```

In `src/server.ts`, instantiate:

```ts
const notifier = config.notificationUrl
  ? new HttpNotifier({
      url: config.notificationUrl,
      token: config.notificationToken,
      targetType: config.notificationTargetType,
      targetId: config.notificationTargetId,
      source: "codex-web"
    })
  : new NullNotifier();
attachEventNotifications(events, notifier);
```

- [ ] **Step 6: Run notifier/config tests**

Run:

```bash
npm test -- tests/notifier.test.ts tests/config.test.ts --run
```

Expected: PASS.

---

### Task 5: Smoke Cleanup Contract

**Files:**
- Modify: `scripts/smoke-live-codex.ts`
- Modify: `tests/live-smoke-contract.test.ts`

- [ ] **Step 1: Write failing cleanup test**

Refactor `scripts/smoke-live-codex.ts` to export a testable `runSmoke` function is the target. First extend `tests/live-smoke-contract.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { runSmoke } from "../scripts/smoke-live-codex.js";

test("runSmoke closes client and manager when turn wait fails", async () => {
  const client = { connect: vi.fn(), close: vi.fn() } as any;
  const manager = { ensureRunning: vi.fn(async () => ({ url: "ws://127.0.0.1:1" })), shutdown: vi.fn(async () => undefined) };
  const bridge = {
    startThread: vi.fn(async () => ({ thread: { id: "thread-1" } })),
    startTurn: vi.fn(async () => ({ turn: { id: "turn-1" } }))
  } as any;

  await expect(runSmoke({
    manager,
    clientFactory: () => client,
    bridgeFactory: () => bridge,
    waitForTurnCompletion: vi.fn(async () => { throw new Error("boom"); }),
    cwd: "D:\\repo"
  })).rejects.toThrow("boom");

  expect(client.close).toHaveBeenCalled();
  expect(manager.shutdown).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run smoke contract test to verify failure**

Run:

```bash
npm test -- tests/live-smoke-contract.test.ts --run
```

Expected: FAIL because `runSmoke` is not exported.

- [ ] **Step 3: Implement runSmoke with finally cleanup**

In `scripts/smoke-live-codex.ts`, add exported dependency interface and function:

```ts
export interface RunSmokeDeps {
  manager: Pick<CodexAppServerManager, "ensureRunning" | "shutdown">;
  clientFactory: (endpoint: { url: string; token?: string }) => Pick<CodexJsonRpcClient, "connect" | "close">;
  bridgeFactory: (client: any, events: EventStore) => Pick<CodexBridge, "startThread" | "startTurn">;
  waitForTurnCompletion: typeof waitForTurnCompletion;
  cwd: string;
}

export async function runSmoke(deps: RunSmokeDeps): Promise<unknown> {
  const events = new EventStore();
  let client: Pick<CodexJsonRpcClient, "connect" | "close"> | undefined;
  try {
    const endpoint = await deps.manager.ensureRunning();
    client = deps.clientFactory(endpoint);
    console.error("[smoke] connecting to codex app-server");
    await client.connect();
    const bridge = deps.bridgeFactory(client, events);
    console.error("[smoke] starting thread");
    const threadResponse = await bridge.startThread({ cwd: deps.cwd }) as any;
    const threadId = threadResponse.thread.id;
    console.error(`[smoke] starting turn in ${threadId}`);
    const turnResponse = await bridge.startTurn(threadId, "Reply with exactly: codex web bridge smoke ok") as any;
    const turnId = turnResponse.turn.id;
    console.error(`[smoke] waiting for turn ${turnId}`);
    await deps.waitForTurnCompletion(events, threadId, turnId, 120_000);
    return { ok: true, threadId, turnId, eventTypes: events.list({ threadId }).map((event) => event.type) };
  } finally {
    client?.close();
    await deps.manager.shutdown();
  }
}
```

Change `main()` to call `runSmoke` with real dependencies and `console.log(JSON.stringify(result, null, 2))`.

- [ ] **Step 4: Run smoke contract tests**

Run:

```bash
npm test -- tests/live-smoke-contract.test.ts --run
```

Expected: PASS.

---

### Task 6: Full Verification

**Files:**
- No code changes unless verification exposes failures.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run TypeScript build**

Run:

```bash
npm run build
```

Expected: exit code 0.

- [ ] **Step 3: Run local live smoke**

Run:

```bash
$env:CODEX_APP_SERVER_PORT='49318'; $env:SMOKE_DATA_DIR='.data-smoke-final'; $env:SMOKE_REQUEST_TIMEOUT_MS='30000'; npm run smoke:codex
```

Expected: JSON output with `"ok": true` and event types including `codex.turn/completed` and `turn.completed`.

- [ ] **Step 4: Confirm no test app-server remains**

Run:

```bash
Get-NetTCPConnection -LocalPort 49318 -ErrorAction SilentlyContinue
```

Expected: no listener output.


import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAppServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { EventStore } from "../src/events/event-store.js";
import { ProjectStore } from "../src/projects/project-store.js";
import { ThemeStore } from "../src/themes/theme-store.js";
import { ThreadMetadataStore } from "../src/threads/thread-metadata-store.js";
import { UserPreferencesStore } from "../src/preferences/user-preferences-store.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const servers: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("approval routes", () => {
  test("lists pending requests and approves/rejects them", async () => {
    const bridge = {
      listThreads: vi.fn(),
      startThread: vi.fn(),
      resumeThread: vi.fn(),
      readThread: vi.fn(),
      rollbackThread: vi.fn(),
      compactThread: vi.fn(),
      startTurn: vi.fn(),
      interruptTurn: vi.fn(),
      steerTurn: vi.fn(),
      setThreadGoal: vi.fn(),
      getThreadGoal: vi.fn(),
      clearThreadGoal: vi.fn(),
      listSkills: vi.fn(),
      listPlugins: vi.fn(),
      listMcpServers: vi.fn(),
      readConfig: vi.fn(),
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
  const dataDir = await mkdtemp(join(tmpdir(), "codex-web-approval-"));
  tempDirs.push(dataDir);
  const { app, attachWebSocket } = createAppServer({
    config: loadConfig({ CODEX_WEB_DATA_DIR: dataDir }),
    bridge,
    events: new EventStore(),
    projects: new ProjectStore(dataDir),
    themes: new ThemeStore(dataDir),
    threadMetadata: new ThreadMetadataStore(dataDir),
    preferences: new UserPreferencesStore(dataDir),
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

import { describe, expect, test } from "vitest";
import {
  isCodexToolItem,
  normalizeRawResponseToolCall,
  normalizeRawResponseToolOutput,
  normalizeTokenUsage,
  normalizeToolCallFromItem,
  normalizeTurnTiming
} from "../web/src/codex-normalizers.js";

describe("codex normalizers", () => {
  test("normalizes common app-server tool item shapes", () => {
    expect(isCodexToolItem({ type: "commandExecution" })).toBe(true);
    expect(normalizeToolCallFromItem({
      id: "cmd-1",
      type: "commandExecution",
      command: "rg -n TODO",
      cwd: "D:\\codex-web",
      status: "completed",
      exitCode: 0
    })).toEqual(expect.objectContaining({
      id: "cmd-1",
      type: "commandExecution",
      title: "rg -n TODO",
      command: "rg -n TODO",
      cwd: "D:\\codex-web",
      status: "completed",
      exitCode: 0
    }));

    expect(normalizeToolCallFromItem({
      type: "fileChange",
      changes: [
        { path: "web/src/App.tsx", kind: { type: "update" }, diff: "@@ -1 +1 @@" }
      ]
    })).toEqual(expect.objectContaining({
      type: "fileChange",
      title: "修改文件 · App.tsx",
      changes: [expect.objectContaining({ path: "web/src/App.tsx", kind: "update" })]
    }));

    expect(normalizeToolCallFromItem({
      type: "mcpToolCall",
      server: "chrome-devtools",
      tool: "take_snapshot",
      arguments: { verbose: false }
    })).toEqual(expect.objectContaining({
      type: "mcpToolCall",
      title: "chrome-devtools / take_snapshot",
      toolName: "take_snapshot",
      server: "chrome-devtools"
    }));
  });

  test("normalizes raw response tool calls and outputs", () => {
    expect(normalizeRawResponseToolCall({
      type: "web_search_call",
      id: "search-1",
      action: { query: "codex app server" },
      status: "completed"
    })).toEqual(expect.objectContaining({
      id: "search-1",
      type: "webSearch",
      title: "网络搜索",
      status: "completed"
    }));

    expect(normalizeRawResponseToolCall({
      type: "function_call",
      call_id: "image-1",
      name: "view_image",
      arguments: "{\"path\":\"C:\\\\tmp\\\\a.png\"}"
    })).toEqual(expect.objectContaining({
      id: "image-1",
      type: "imageView",
      title: "查看图片 · a.png",
      result: "C:\\tmp\\a.png"
    }));

    expect(normalizeRawResponseToolOutput({
      type: "function_call_output",
      call_id: "image-1",
      output: "ok"
    })).toEqual({ id: "image-1", output: "ok" });
  });

  test("normalizes turn timing and token usage", () => {
    expect(normalizeTurnTiming({
      turnId: "turn-1",
      payload: {
        params: {
          turn: {
            startedAt: 1_000,
            completedAt: 2_500
          }
        }
      }
    }, 3_000)).toEqual({
      turnId: "turn-1",
      startedAt: 1_000_000,
      completedAt: 2_500_000,
      durationMs: 1_500_000
    });

    expect(normalizeTokenUsage({
      payload: {
        params: {
          tokenUsage: {
            last: {
              inputTokens: 10,
              cachedInputTokens: 2,
              outputTokens: 7,
              totalTokens: 17
            }
          }
        }
      }
    })).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 7,
      totalTokens: 17
    });
  });
});

import { describe, expect, test } from "vitest";
import { diffStatsForToolCall, fileChangeDiffCode, fileChangeViews } from "../web/src/file-change-display.js";
import type { UiToolCall } from "../web/src/types.js";

describe("file change display", () => {
  test("keeps multiple file changes separated and totals their stats", () => {
    const toolCall: UiToolCall = {
      id: "file-1",
      type: "fileChange",
      command: "",
      changes: [
        {
          path: "D:\\codex-web\\agent.md",
          kind: "update",
          diff: "@@ -9,3 +9,4 @@\n-old\n+new\n+extra\n"
        },
        {
          path: "D:\\codex-web\\docs\\superpowers\\plans\\2026-05-31-defensive-refactor.md",
          kind: "add",
          diff: "# 防御性编程收敛重构计划\n\n> 状态：待确认\n"
        }
      ]
    };

    expect(diffStatsForToolCall(toolCall)).toEqual({ removed: 1, added: 5 });
    expect(fileChangeViews(toolCall)).toEqual([
      expect.objectContaining({
        label: "更新",
        path: "D:\\codex-web\\agent.md",
        stats: { removed: 1, added: 2 }
      }),
      expect.objectContaining({
        label: "新增",
        path: "D:\\codex-web\\docs\\superpowers\\plans\\2026-05-31-defensive-refactor.md",
        stats: { removed: 0, added: 3 }
      })
    ]);
  });

  test("renders added file content as added diff lines", () => {
    expect(fileChangeDiffCode({
      path: "new.md",
      kind: "add",
      diff: "第一行\n\n第三行\n"
    })).toBe("+第一行\n+\n+第三行");
  });
});

import { describe, expect, test, vi } from "vitest";
import { CodexBridge } from "../src/codex/codex-bridge.js";
import { EventStore } from "../src/events/event-store.js";

describe("CodexBridge", () => {
  test("maps thread and turn methods to Codex JSON-RPC", async () => {
    const client = fakeClient();
    const bridge = new CodexBridge(client as any, new EventStore());

    await bridge.listThreads({ cwd: "D:\\repo" });
    await bridge.startThread({ cwd: "D:\\repo", model: "gpt-test" });
    await bridge.resumeThread("thread-1");
    await bridge.readThread("thread-1", true);
    await bridge.rollbackThread("thread-1", 2);
    await bridge.compactThread("thread-1");
    await bridge.startTurn("thread-1", "hello");
    await bridge.interruptTurn("thread-1", "turn-1");
    await bridge.steerTurn("thread-1", "more", "turn-1");
    await bridge.setThreadGoal("thread-1", { objective: "ship", status: "active", tokenBudget: 100 });
    await bridge.getThreadGoal("thread-1");
    await bridge.clearThreadGoal("thread-1");

    expect(client.request.mock.calls).toEqual([
      ["thread/list", { cwd: "D:\\repo", limit: 50, sortDirection: "desc" }],
      ["thread/start", { cwd: "D:\\repo", model: "gpt-test" }],
      ["thread/resume", { threadId: "thread-1" }],
      ["thread/read", { threadId: "thread-1", includeTurns: true }],
      ["thread/rollback", { threadId: "thread-1", numTurns: 2 }],
      ["thread/compact/start", { threadId: "thread-1" }],
      ["turn/start", { threadId: "thread-1", input: [{ type: "text", text: "hello", text_elements: [] }] }],
      ["turn/interrupt", { threadId: "thread-1", turnId: "turn-1" }],
      ["turn/steer", { threadId: "thread-1", input: [{ type: "text", text: "more", text_elements: [] }], expectedTurnId: "turn-1" }],
      ["thread/goal/set", { threadId: "thread-1", objective: "ship", status: "active", tokenBudget: 100 }],
      ["thread/goal/get", { threadId: "thread-1" }],
      ["thread/goal/clear", { threadId: "thread-1" }]
    ]);
  });

  test("maps capability methods", async () => {
    const client = fakeClient();
    const bridge = new CodexBridge(client as any, new EventStore());

    await bridge.listSkills(["D:\\repo"]);
    await bridge.listPlugins();
    await bridge.listMcpServers();
    await bridge.listModels({ limit: 20 });
    await bridge.readConfig();
    await bridge.writeSkillConfig({ path: "D:\\repo\\.codex\\skills\\x\\SKILL.md", enabled: false });
    await bridge.writeConfigBatch({
      edits: [{ keyPath: "plugins.superpowers@openai-curated.enabled", value: false, mergeStrategy: "replace" }],
      reloadUserConfig: true
    });

    expect(client.request.mock.calls).toEqual([
      ["skills/list", { cwds: ["D:\\repo"], forceReload: false }],
      ["plugin/list", {}],
      ["mcpServerStatus/list", {}],
      ["model/list", { limit: 20 }],
      ["config/read", {}],
      ["skills/config/write", { path: "D:\\repo\\.codex\\skills\\x\\SKILL.md", enabled: false }],
      ["config/batchWrite", {
        edits: [{ keyPath: "plugins.superpowers@openai-curated.enabled", value: false, mergeStrategy: "replace" }],
        reloadUserConfig: true
      }]
    ]);
  });

  test("maps native thread management methods", async () => {
    const client = fakeClient();
    const bridge = new CodexBridge(client as any, new EventStore());

    await bridge.forkThread("thread-1", { model: "gpt-test" });
    await bridge.archiveThread("thread-1");
    await bridge.setThreadName("thread-1", "新标题");
    await bridge.getConversationSummary("thread-1");

    expect(client.request.mock.calls).toEqual([
      ["thread/fork", { threadId: "thread-1", model: "gpt-test" }],
      ["thread/archive", { threadId: "thread-1" }],
      ["thread/name/set", { threadId: "thread-1", name: "新标题" }],
      ["getConversationSummary", { conversationId: "thread-1" }]
    ]);
  });

  test("can start turns with mixed user input items and overrides", async () => {
    const client = fakeClient();
    const bridge = new CodexBridge(client as any, new EventStore());

    await bridge.startTurnItems("thread-1", [
      { type: "text", text: "look", text_elements: [] },
      { type: "localImage", path: "D:\\codex-web\\.data\\uploads\\shot.png", detail: "high" }
    ], {
      effort: "high",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    });

    expect(client.request).toHaveBeenCalledWith("turn/start", {
      threadId: "thread-1",
      input: [
        { type: "text", text: "look", text_elements: [] },
        { type: "localImage", path: "D:\\codex-web\\.data\\uploads\\shot.png", detail: "high" }
      ],
      effort: "high",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    });
  });

  test("records Codex turn notifications", () => {
    const client = fakeClient();
    const store = new EventStore();
    new CodexBridge(client as any, store);

    client.emitNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    client.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed" } } });

    expect(store.getTurn("thread-1", "turn-1")?.status).toBe("completed");
    expect(store.list({ threadId: "thread-1" }).map((event) => event.type)).toEqual([
      "codex.turn/started",
      "turn.started",
      "codex.turn/completed",
      "turn.completed"
    ]);
  });

  test("stores, resolves, and broadcasts server request decisions", () => {
    const client = fakeClient();
    const store = new EventStore();
    const bridge = new CodexBridge(client as any, store);

    client.emitServerRequest({ method: "item/commandExecution/requestApproval", id: 42, params: { threadId: "thread-1", turnId: "turn-1" } });
    expect(bridge.getPendingServerRequests()).toEqual([
      { method: "item/commandExecution/requestApproval", id: 42, params: { threadId: "thread-1", turnId: "turn-1" } }
    ]);

    bridge.approveServerRequest("42", { decision: "approved" });
    expect(client.respond).toHaveBeenCalledWith(42, { decision: "accept" });
    expect(bridge.getPendingServerRequests()).toEqual([]);
    expect(store.list().at(-1)).toEqual(expect.objectContaining({
      type: "codex.serverRequest/resolved",
      threadId: "thread-1",
      turnId: "turn-1",
      payload: expect.objectContaining({ requestId: 42, decision: "accept" })
    }));

    client.emitServerRequest({ method: "item/fileChange/requestApproval", id: 43, params: { threadId: "thread-1" } });
    bridge.rejectServerRequest("43", "Denied from web");
    expect(client.respond).toHaveBeenCalledWith(43, { decision: "decline" });
  });

  test("records failure details from turn completion notifications", () => {
    const client = fakeClient();
    const store = new EventStore();
    new CodexBridge(client as any, store);

    client.emitNotification({ method: "turn/started", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    client.emitNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: {
          id: "turn-1",
          status: "failed",
          error: { message: "Usage limit exceeded", codexErrorInfo: "UsageLimitExceeded" }
        }
      }
    });

    expect(store.getTurn("thread-1", "turn-1")?.status).toBe("failed");
    expect(store.list({ threadId: "thread-1" }).at(-1)).toEqual(expect.objectContaining({
      type: "turn.completed",
      payload: expect.objectContaining({
        status: "failed",
        message: "Usage limit exceeded",
        error: expect.objectContaining({ message: "Usage limit exceeded" })
      })
    }));
  });
});

function fakeClient() {
  let notificationListener: ((notification: any) => void) | undefined;
  let serverRequestListener: ((request: any) => void) | undefined;
  return {
    request: vi.fn(async () => ({})),
    respond: vi.fn(),
    reject: vi.fn(),
    onNotification: vi.fn((listener: (notification: any) => void) => {
      notificationListener = listener;
      return () => {};
    }),
    onServerRequest: vi.fn((listener: (request: any) => void) => {
      serverRequestListener = listener;
      return () => {};
    }),
    emitNotification(notification: any) {
      notificationListener?.(notification);
    },
    emitServerRequest(request: any) {
      serverRequestListener?.(request);
    }
  };
}

export interface AppConfig {
  host: string;
  port: number;
  publicBaseUrl?: string;
  codexBin: string;
  codexHome?: string;
  codexAppServerUrl?: string;
  codexAppServerPort: number;
  dataDir: string;
  projectRoot: string;
  bridgeToken?: string;
  enableExperimentalCodexApi: boolean;
  notificationUrl?: string;
  notificationToken?: string;
  notificationTargetType?: string;
  notificationTargetId?: string;
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): AppConfig {
  return {
    host: env.HOST || "0.0.0.0",
    port: parsePort(env.PORT, "PORT", 49380),
    publicBaseUrl: emptyToUndefined(env.PUBLIC_BASE_URL),
    codexBin: env.CODEX_BIN || "codex",
    codexHome: emptyToUndefined(env.CODEX_HOME),
    codexAppServerUrl: emptyToUndefined(env.CODEX_APP_SERVER_URL),
    codexAppServerPort: parsePort(env.CODEX_APP_SERVER_PORT, "CODEX_APP_SERVER_PORT", 49317),
    dataDir: env.CODEX_WEB_DATA_DIR || env.DATA_DIR || ".data",
    projectRoot: env.CODEX_WEB_PROJECT_ROOT || process.cwd(),
    bridgeToken: emptyToUndefined(env.BRIDGE_TOKEN),
    enableExperimentalCodexApi: parseBoolean(env.ENABLE_EXPERIMENTAL_CODEX_API, true),
    notificationUrl: emptyToUndefined(env.NOTIFY_URL),
    notificationToken: emptyToUndefined(env.NOTIFY_TOKEN),
    notificationTargetType: emptyToUndefined(env.NOTIFY_TARGET_TYPE),
    notificationTargetId: emptyToUndefined(env.NOTIFY_TARGET_ID)
  };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value.trim() === "") return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`ENABLE_EXPERIMENTAL_CODEX_API must be a boolean`);
}

function parsePort(value: string | undefined, name: string, defaultValue: number): number {
  if (value === undefined || value.trim() === "") return defaultValue;
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(`${name} must be an integer`);
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error(`${name} must be between 1 and 65535`);
  }
  return port;
}

import { describe, expect, test } from "vitest";
import { eventsToMessages, threadReadToMessages } from "../web/src/thread-history.js";

describe("threadReadToMessages", () => {
  test("converts app-server turn items into UI messages", () => {
    const messages = threadReadToMessages({
      thread: {
        id: "thread-1",
        turns: [
          {
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "你好" }]
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "你好，我在。"
              }
            ]
          }
        ]
      }
    });

    expect(messages).toEqual([
      expect.objectContaining({ id: "user-1", role: "user", text: "你好" }),
      expect.objectContaining({ id: "assistant-turn-turn-0", role: "assistant", text: "你好，我在。" })
    ]);
  });

  test("groups multiple assistant messages and tool calls in one turn", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "创建文件" }]
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "我先看目录。"
              },
              {
                id: "call-1",
                type: "commandExecution",
                command: "Get-ChildItem",
                status: "completed"
              },
              {
                id: "agent-2",
                type: "agentMessage",
                text: "已确认，可以创建。"
              }
            ]
          }
        ]
      }
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(expect.objectContaining({ role: "user", text: "创建文件" }));
    expect(messages[1]).toEqual(expect.objectContaining({
      id: "assistant-turn-turn-1",
      role: "assistant",
      text: "我先看目录。\n\n已确认，可以创建。",
      assistantParts: [
        expect.objectContaining({ type: "text", id: "agent-1", text: "我先看目录。" }),
        expect.objectContaining({ type: "tool", id: "call-1", toolCall: expect.objectContaining({ command: "Get-ChildItem" }) }),
        expect.objectContaining({ type: "text", id: "agent-2", text: "已确认，可以创建。" })
      ]
    }));
  });

  test("attaches subsequent user messages in one turn as steer messages", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "先写春节祝福" }]
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "我先准备。"
              },
              {
                id: "user-2",
                type: "userMessage",
                content: [{ type: "text", text: "改成圣诞祝福" }]
              },
              {
                id: "agent-2",
                type: "agentMessage",
                text: "已改成圣诞祝福。"
              }
            ]
          }
        ]
      }
    });

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual(expect.objectContaining({ id: "user-1", role: "user", text: "先写春节祝福" }));
    expect(messages[1]).toEqual(expect.objectContaining({
      id: "assistant-turn-turn-1",
      role: "assistant",
      text: "我先准备。\n\n已改成圣诞祝福。",
      assistantParts: [
        expect.objectContaining({ type: "text", id: "agent-1" }),
        expect.objectContaining({ type: "steer", id: "user-2", text: "改成圣诞祝福", status: "sent" }),
        expect.objectContaining({ type: "text", id: "agent-2" })
      ],
      steerMessages: [
        expect.objectContaining({ id: "user-2", text: "改成圣诞祝福", status: "sent" })
      ]
    }));
  });

  test("rebuilds command executions from persisted bridge events", () => {
    const messages = eventsToMessages([
      {
        seq: 0,
        type: "codex.item/started",
        createdAt: "2026-05-29T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "userMessage", id: "user-1", content: [{ type: "text", text: "先写春节祝福" }] } } }
      },
      {
        seq: 1,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "我先检查。" } } }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "commandExecution", id: "call-1", command: "Get-Location", status: "completed", aggregatedOutput: "D:\\repo" } } }
      },
      {
        seq: 3,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-2", text: "完成。" } } }
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        id: "assistant-turn-turn-1",
        text: "我先检查。\n\n完成。",
        assistantParts: [
          expect.objectContaining({ type: "text", id: "agent-1" }),
          expect.objectContaining({ type: "tool", id: "call-1", toolCall: expect.objectContaining({ aggregatedOutput: "D:\\repo" }) }),
          expect.objectContaining({ type: "text", id: "agent-2" })
        ]
      })
    ]);
  });

  test("restores steer messages from bridge events without creating user bubbles", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "userMessage", id: "user-1", content: [{ type: "text", text: "先写春节祝福" }] } } }
      },
      {
        seq: 2,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "我先准备。" } } }
      },
      {
        seq: 3,
        type: "codex.item/started",
        createdAt: "2026-05-29T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "userMessage", id: "user-2", content: [{ type: "text", text: "改成圣诞祝福" }] } } }
      },
      {
        seq: 4,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:02.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "userMessage", id: "user-2", content: [{ type: "text", text: "改成圣诞祝福" }] } } }
      },
      {
        seq: 5,
        type: "codex.item/completed",
        createdAt: "2026-05-29T00:00:03.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-2", text: "已改成圣诞祝福。" } } }
      }
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(expect.objectContaining({
      role: "assistant",
      text: "我先准备。\n\n已改成圣诞祝福。",
      assistantParts: [
        expect.objectContaining({ type: "text", id: "agent-1" }),
        expect.objectContaining({ type: "steer", id: "user-2", text: "改成圣诞祝福", status: "sent" }),
        expect.objectContaining({ type: "text", id: "agent-2" })
      ],
      steerMessages: [
        expect.objectContaining({ id: "user-2", text: "改成圣诞祝福", status: "sent" })
      ]
    }));
  });

  test("renders context compaction markers from bridge events", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "thread/compacted",
        createdAt: "2026-05-29T00:00:00.000Z",
        threadId: "thread-1",
        payload: {}
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "system",
        text: "上下文已压缩",
        systemMarker: "contextCompaction",
        createdAt: Date.parse("2026-05-29T00:00:00.000Z")
      })
    ]);
  });

  test("attaches command execution items to assistant messages", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            items: [
              {
                id: "agent-1",
                type: "agentMessage",
                text: "我先看一下文件。"
              },
              {
                id: "call-1",
                type: "commandExecution",
                command: "Get-ChildItem -Force",
                cwd: "D:\\repo",
                status: "completed",
                aggregatedOutput: "file.txt",
                exitCode: 0,
                durationMs: 123
              }
            ]
          }
        ]
      }
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "assistant-turn-turn-0",
        role: "assistant",
        text: "我先看一下文件。",
        assistantParts: [
          expect.objectContaining({ type: "text", id: "agent-1", text: "我先看一下文件。" }),
          expect.objectContaining({
            type: "tool",
            id: "call-1",
            toolCall: expect.objectContaining({
              command: "Get-ChildItem -Force",
              cwd: "D:\\repo",
              aggregatedOutput: "file.txt",
              exitCode: 0,
              durationMs: 123
            })
          })
        ]
      })
    ]);
  });

  test("converts rollout event messages when app-server returns session entries", () => {
    const messages = threadReadToMessages({
      entries: [
        {
          timestamp: "2026-05-28T23:41:51.859Z",
          type: "event_msg",
          payload: { type: "user_message", message: "创建一个文件" }
        },
        {
          timestamp: "2026-05-28T23:42:09.087Z",
          type: "event_msg",
          payload: { type: "agent_message", message: "已创建。" }
        }
      ]
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", text: "创建一个文件", createdAt: Date.parse("2026-05-28T23:41:51.859Z") }),
      expect.objectContaining({ role: "assistant", text: "已创建。", createdAt: Date.parse("2026-05-28T23:42:09.087Z") })
    ]);
  });

  test("uses payload timestamp for Codex user messages restored from turns", () => {
    const messages = threadReadToMessages({
      turns: [
        {
          id: "turn-1",
          startedAt: "2026-05-28T23:42:09.087Z",
          items: [
            {
              type: "event_msg",
              payload: {
                type: "user_message",
                timestamp: "2026-05-28T23:41:51.859Z",
                message: "你好"
              }
            },
            {
              type: "agentMessage",
              id: "agent-1",
              text: "你好。"
            }
          ]
        }
      ]
    });

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "你好",
      createdAt: Date.parse("2026-05-28T23:41:51.859Z")
    }));
  });

  test("uses turn startedAt for Codex user messages without item timestamps", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "turn-1",
            startedAt: 1779992807,
            completedAt: 1779992825,
            items: [
              {
                type: "userMessage",
                id: "item-1",
                content: [{ type: "text", text: "你好\n", text_elements: [] }]
              },
              {
                type: "agentMessage",
                id: "item-2",
                text: "你好。"
              }
            ]
          }
        ]
      }
    });

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "你好\n",
      createdAt: 1779992807 * 1000
    }));
  });

  test("does not fabricate current timestamps for history items without timestamps", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "缺少时间" }]
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "缺少时间的回复"
              }
            ]
          }
        ]
      }
    });

    expect(messages[0].createdAt).toBeUndefined();
    expect(messages[1].createdAt).toBeUndefined();
  });

  test("restores user image attachments from Codex localImage content", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [
                  { type: "text", text: "描述一下截图", text_elements: [] },
                  { type: "localImage", path: "D:\\codex-web\\.data\\uploads\\images\\shot.png", detail: "high" }
                ]
              }
            ]
          }
        ]
      }
    });

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "描述一下截图",
      images: [
        expect.objectContaining({
          kind: "image",
          name: "shot.png",
          previewUrl: "/api/uploads/images/shot.png",
          input: expect.objectContaining({ type: "localImage", path: "D:\\codex-web\\.data\\uploads\\images\\shot.png" })
        })
      ],
      attachments: [
        expect.objectContaining({ kind: "image", name: "shot.png" })
      ]
    }));
  });

  test("restores uploaded file cards from injected local file paths", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [
                  {
                    type: "text",
                    text: [
                      "这个脚本的作用是什么",
                      "",
                      "用户上传了以下本地临时文件，请按需读取或处理：",
                      "- proxy-tunnel.ps1: D:\\codex-web\\.data\\uploads\\files\\1780093080071-proxy-tunnel.ps1"
                    ].join("\n"),
                    text_elements: []
                  }
                ]
              }
            ]
          }
        ]
      }
    });

    expect(messages[0]).toEqual(expect.objectContaining({
      role: "user",
      text: "这个脚本的作用是什么",
      attachments: [
        expect.objectContaining({
          kind: "file",
          name: "proxy-tunnel.ps1",
          path: "D:\\codex-web\\.data\\uploads\\files\\1780093080071-proxy-tunnel.ps1"
        })
      ]
    }));
  });

  test("renders context compaction markers from app-server history", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "user-1",
                type: "userMessage",
                content: [{ type: "text", text: "继续" }]
              },
              {
                id: "compact-1",
                type: "contextCompaction"
              },
              {
                id: "agent-1",
                type: "agentMessage",
                text: "我接着处理。"
              }
            ]
          }
        ]
      }
    });

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", text: "继续" }),
      expect.objectContaining({ role: "system", systemMarker: "contextCompaction", text: "上下文已压缩" }),
      expect.objectContaining({ role: "assistant", text: "我接着处理。" })
    ]);
  });

  test("renders manual compact-only turns as rollbackable compact user action", () => {
    const messages = threadReadToMessages({
      thread: {
        turns: [
          {
            id: "compact-turn-1",
            status: "completed",
            startedAt: 1780214571,
            completedAt: 1780214589,
            durationMs: 17608,
            items: [
              {
                id: "compact-1",
                type: "contextCompaction"
              }
            ]
          }
        ]
      }
    });

    expect(messages).toEqual([
      expect.objectContaining({
        id: "compact-user-compact-turn-1",
        role: "user",
        text: "/compact",
        turnId: "compact-turn-1",
        synthetic: "manualCompact"
      }),
      expect.objectContaining({
        role: "system",
        systemMarker: "contextCompaction",
        text: "上下文已压缩",
        turnId: "compact-turn-1"
      })
    ]);
  });

  test("does not render in-progress context compaction items as completed history markers", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.item/started",
        createdAt: "2026-05-29T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-compact",
        payload: {
          params: {
            item: {
              id: "compact-1",
              type: "contextCompaction"
            }
          }
        }
      }
    ]);

    expect(messages).toEqual([]);
  });

  test("shows failure details restored from turn completion events", () => {
    const messages = eventsToMessages([
      {
        seq: 1,
        type: "codex.item/completed",
        createdAt: "2026-05-31T00:00:00.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: { params: { item: { type: "agentMessage", id: "agent-1", text: "我先试一下。" } } }
      },
      {
        seq: 2,
        type: "turn.completed",
        createdAt: "2026-05-31T00:00:01.000Z",
        threadId: "thread-1",
        turnId: "turn-1",
        payload: {
          status: "failed",
          error: { message: "Usage limit exceeded", codexErrorInfo: "UsageLimitExceeded" }
        }
      }
    ]);

    expect(messages).toEqual([
      expect.objectContaining({
        role: "assistant",
        text: "我先试一下。",
        statusText: "Usage limit exceeded",
        statusTone: "danger"
      })
    ]);
  });
});

import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cwd } from "node:process";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { createAppServer } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { EventStore } from "../src/events/event-store.js";
import { ProjectStore } from "../src/projects/project-store.js";
import { ThemeStore } from "../src/themes/theme-store.js";
import { ThreadMetadataStore } from "../src/threads/thread-metadata-store.js";
import { UserPreferencesStore } from "../src/preferences/user-preferences-store.js";

const servers: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HTTP routes", () => {
  test("serves health, status, thread, turn, capability, and event APIs", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    events.append({ type: "note", threadId: "thread-1", payload: { ok: true } });
    const { baseUrl } = await startServer(bridge, events);

    await expectJson(`${baseUrl}/health`, { ok: true });
    await expectJson(`${baseUrl}/ready`, { ok: true });
    await expectJson(`${baseUrl}/api/status`, { ok: true, data: expect.objectContaining({ connected: true }) });

    await requestJson(`${baseUrl}/api/workspaces`);
    await requestJson(`${baseUrl}/api/tasks`);
    await requestJson(`${baseUrl}/api/threads?cwd=D%3A%5Crepo`);
    await requestJson(`${baseUrl}/api/threads`, { method: "POST", body: { cwd: "D:\\repo" } });
    await requestJson(`${baseUrl}/api/threads/thread-1`);
    await requestJson(`${baseUrl}/api/threads/thread-1/resume`, { method: "POST", body: {} });
    await requestJson(`${baseUrl}/api/threads/thread-1/turns`, { method: "POST", body: { text: "hello" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/interrupt`, { method: "POST", body: { turnId: "turn-1" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/steer`, { method: "POST", body: { text: "more", turnId: "turn-1" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/rollback`, { method: "POST", body: { numTurns: 2 } });
    await requestJson(`${baseUrl}/api/threads/thread-1/rollback-to-turn`, { method: "POST", body: { turnId: "turn-1" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/compact`, { method: "POST", body: {} });
    await requestJson(`${baseUrl}/api/threads/thread-1/fork`, { method: "POST", body: { overrides: { model: "gpt-test" } } });
    await requestJson(`${baseUrl}/api/threads/thread-1`, { method: "DELETE", body: { cwd: "D:\\repo" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/goal`, { method: "POST", body: { objective: "完成 codex-web", status: "active" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/goal`);
    await requestJson(`${baseUrl}/api/threads/thread-1/goal`, { method: "DELETE" });
    await requestJson(`${baseUrl}/api/threads/thread-1/name`, { method: "POST", body: { name: "新标题" } });
    await requestJson(`${baseUrl}/api/threads/thread-1/title/generate`, { method: "POST", body: {} });
    await requestJson(`${baseUrl}/api/capabilities?cwd=D%3A%5Crepo`);
    const preferences = await requestJson(`${baseUrl}/api/preferences`);
    expect(preferences.data).toEqual(expect.objectContaining({ colorMode: "light", defaultWorkMode: "yolo", approvalDetailsCollapsedByDefault: true, sendBehavior: "enter" }));
    const updatedPreferences = await requestJson(`${baseUrl}/api/preferences`, { method: "PUT", body: { colorMode: "dark", sidebarWidth: 320, approvalDetailsCollapsedByDefault: false, sendBehavior: "shiftEnter" } });
    expect(updatedPreferences.data).toEqual(expect.objectContaining({ colorMode: "dark", sidebarWidth: 320, approvalDetailsCollapsedByDefault: false, sendBehavior: "shiftEnter" }));
    const eventResponse = await requestJson(`${baseUrl}/api/events?threadId=thread-1`);

    expect(eventResponse.data[0].type).toBe("note");
    expect(bridge.listThreads).toHaveBeenCalledWith({});
    expect(bridge.listThreads).toHaveBeenCalledWith({ cwd: "D:\\repo", searchTerm: undefined });
    expect(bridge.resumeThread).toHaveBeenCalledWith("thread-1");
    expect(bridge.startTurn).toHaveBeenCalledWith("thread-1", "hello", {});
    expect(bridge.steerTurn).toHaveBeenCalledWith("thread-1", "more", "turn-1");
    expect(bridge.rollbackThread).toHaveBeenCalledWith("thread-1", 2);
    expect(bridge.readThread).toHaveBeenCalledWith("thread-1", true);
    expect(bridge.rollbackThread).toHaveBeenCalledWith("thread-1", 1);
    expect(bridge.compactThread).toHaveBeenCalledWith("thread-1");
    expect(bridge.forkThread).toHaveBeenCalledWith("thread-1", { model: "gpt-test" });
    expect(bridge.archiveThread).toHaveBeenCalledWith("thread-1");
    expect(bridge.setThreadGoal).toHaveBeenCalledWith("thread-1", { objective: "完成 codex-web", status: "active" });
    expect(bridge.getThreadGoal).toHaveBeenCalledWith("thread-1");
    expect(bridge.clearThreadGoal).toHaveBeenCalledWith("thread-1");
    expect(bridge.setThreadName).toHaveBeenCalledWith("thread-1", "新标题");
  });

  test("GET /api/tasks returns task summaries", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    events.recordTurnStart("thread-1", "turn-1");
    const { baseUrl } = await startServer(bridge, events);

    const response = await requestJson(`${baseUrl}/api/tasks`);

    expect(response.data).toEqual([
      expect.objectContaining({ threadId: "thread-1", turnId: "turn-1", status: "running" })
    ]);
  });

  test("GET /api/diagnostics/runtime returns runtime pressure counters", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    events.append({ type: "note", payload: {} });
    const { baseUrl } = await startServer(bridge, events);

    await requestJson(`${baseUrl}/api/status`);
    const response = await requestJson(`${baseUrl}/api/diagnostics/runtime`);

    expect(response.data).toEqual(expect.objectContaining({
      uptimeMs: expect.any(Number),
      memory: expect.objectContaining({ rss: expect.any(Number) }),
      http: expect.objectContaining({
        totalRequests: expect.any(Number),
        byRoute: expect.arrayContaining([
          expect.objectContaining({ key: "GET /api/status" })
        ])
      }),
      websocket: expect.objectContaining({ activeConnections: 0 }),
      events: expect.objectContaining({ eventCount: 1 })
    }));
  });

  test("GET /api/threads includes local Codex session history when app-server list is empty", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-codex-home-"));
    tempDirs.push(codexHome);
    const sessionDir = join(codexHome, "sessions", "2026", "05", "29");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "rollout-2026-05-29T07-41-48-019e70f7-3103-7e52-b519-5128389b9251.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-28T23:41:49.956Z",
        type: "session_meta",
        payload: {
          id: "019e70f7-3103-7e52-b519-5128389b9251",
          cwd: "D:\\codex-web\\project-2",
          timestamp: "2026-05-28T23:41:48.721Z"
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-28T23:41:51.859Z",
        type: "event_msg",
        payload: { type: "user_message", message: "你好" }
      })
    ].join("\n"), "utf8");
    const { baseUrl } = await startServer(bridge, events, undefined, { codexHome });

    const response = await requestJson(`${baseUrl}/api/threads?cwd=${encodeURIComponent("D:\\codex-web\\project-2")}`);

    expect(response.data.data).toEqual([
      expect.objectContaining({
        id: "019e70f7-3103-7e52-b519-5128389b9251",
        cwd: "D:\\codex-web\\project-2",
        preview: "你好"
      })
    ]);
  });

  test("createAppServer requires core route dependencies", () => {
    expect(() => createAppServer({
      config: loadConfig({}),
      bridge: fakeBridge(),
      events: new EventStore(),
      status: () => ({ connected: true })
    } as any)).toThrow(/Missing required route dependencies/);
  });

  test("GET /api/threads logs local history read failures instead of hiding them silently", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-route-data-"));
    const codexHomeFile = join(dataDir, "codex-home");
    const sessionsFile = join(codexHomeFile, "sessions");
    tempDirs.push(dataDir);
    await mkdir(codexHomeFile, { recursive: true });
    await writeFile(sessionsFile, "not a directory", "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir, codexHome: codexHomeFile });

    try {
      const response = await requestJson(`${baseUrl}/api/threads`);

      expect(response.data.data).toEqual([]);
      expect(warn).toHaveBeenCalledWith("Failed to read local Codex session history", expect.any(Error));
    } finally {
      warn.mockRestore();
    }
  });

  test("serves local filesystem roots and directory listing", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl } = await startServer(bridge, events);

    const roots = await requestJson(`${baseUrl}/api/fs/roots`);
    const listing = await requestJson(`${baseUrl}/api/fs/list?path=${encodeURIComponent(cwd())}`);

    expect(Array.isArray(roots.data)).toBe(true);
    expect(listing.data).toEqual(expect.objectContaining({
      path: expect.any(String),
      entries: expect.any(Array)
    }));
  });

  test("persists project paths", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-projects-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, new ProjectStore(dataDir));

    const added = await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwd() } });
    const listed = await requestJson(`${baseUrl}/api/projects`);

    expect(added.data[0]).toEqual(expect.objectContaining({ cwd: cwd() }));
    expect(listed.data[0]).toEqual(expect.objectContaining({ cwd: cwd() }));
  });

  test("updates persisted project metadata and order", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-projects-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, new ProjectStore(dataDir));
    const cwdA = join(cwd(), "a");
    const cwdB = join(cwd(), "b");

    await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwdA } });
    await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwdB } });
    const renamed = await requestJson(`${baseUrl}/api/projects/rename`, { method: "POST", body: { cwd: cwdA, name: "Renamed" } });
    const moved = await requestJson(`${baseUrl}/api/projects/move`, { method: "POST", body: { cwd: cwdA, direction: "up" } });
    const pinned = await requestJson(`${baseUrl}/api/projects/pin`, { method: "POST", body: { cwd: cwdB } });
    const deleted = await requestJson(`${baseUrl}/api/projects/delete`, { method: "POST", body: { cwd: cwdB } });

    expect(renamed.data.find((project: any) => project.cwd === cwdA).name).toBe("Renamed");
    expect(moved.data[0].cwd).toBe(cwdA);
    expect(pinned.data[0].cwd).toBe(cwdB);
    expect(deleted.data.some((project: any) => project.cwd === cwdB)).toBe(false);
  });

  test("keeps project movement inside pinned or normal partitions", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-project-partitions-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, new ProjectStore(dataDir));
    const cwdA = join(cwd(), "a");
    const cwdB = join(cwd(), "b");
    const cwdC = join(cwd(), "c");

    await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwdA } });
    await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwdB } });
    await requestJson(`${baseUrl}/api/projects`, { method: "POST", body: { cwd: cwdC } });
    await requestJson(`${baseUrl}/api/projects/pin`, { method: "POST", body: { cwd: cwdA } });
    const blocked = await requestJson(`${baseUrl}/api/projects/move`, { method: "POST", body: { cwd: cwdA, direction: "down" } });

    expect(blocked.data.map((project: any) => project.cwd)).toEqual([cwdA, cwdC, cwdB]);
  });

  test("persists thread pin and manual order metadata", async () => {
    const bridge: any = fakeBridge();
    bridge.listThreads = vi.fn(async () => ({
      data: [
        { id: "a", cwd: "D:\\repo", preview: "A", updatedAt: 10, status: "completed" },
        { id: "b", cwd: "D:\\repo", preview: "B", updatedAt: 20, status: "completed" },
        { id: "c", cwd: "D:\\repo", preview: "C", updatedAt: 30, status: "completed" }
      ]
    }));
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-thread-meta-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    await requestJson(`${baseUrl}/api/threads/move`, { method: "POST", body: { cwd: "D:\\repo", threadId: "a", targetThreadId: "c" } });
    await requestJson(`${baseUrl}/api/threads/pin`, { method: "POST", body: { cwd: "D:\\repo", threadId: "b" } });
    const listed = await requestJson(`${baseUrl}/api/threads?cwd=${encodeURIComponent("D:\\repo")}`);
    const metadata = JSON.parse(await readFile(join(dataDir, "thread-metadata.json"), "utf8"));

    expect(listed.data.data.map((thread: any) => thread.id)).toEqual(["b", "c", "a"]);
    expect(listed.data.data.find((thread: any) => thread.id === "b").pinned).toBe(true);
    expect(metadata.threads.some((thread: any) => thread.id === "b" && thread.pinned)).toBe(true);
  });

  test("persists explicit thread order from drag preview placement", async () => {
    const bridge: any = fakeBridge();
    bridge.listThreads = vi.fn(async () => ({
      data: [
        { id: "a", cwd: "D:\\repo", preview: "A", updatedAt: 10, status: "completed" },
        { id: "b", cwd: "D:\\repo", preview: "B", updatedAt: 20, status: "completed" },
        { id: "c", cwd: "D:\\repo", preview: "C", updatedAt: 30, status: "completed" }
      ]
    }));
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-thread-order-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    await requestJson(`${baseUrl}/api/threads/move`, {
      method: "POST",
      body: { cwd: "D:\\repo", threadId: "a", targetThreadId: "c", placement: "after", orderedThreadIds: ["b", "c", "a"] }
    });
    const listed = await requestJson(`${baseUrl}/api/threads?cwd=${encodeURIComponent("D:\\repo")}`);

    expect(listed.data.data.map((thread: any) => thread.id)).toEqual(["b", "c", "a"]);
  });

  test("keeps thread movement inside pinned or normal partitions", async () => {
    const bridge: any = fakeBridge();
    bridge.listThreads = vi.fn(async () => ({
      data: [
        { id: "a", cwd: "D:\\repo", preview: "A", updatedAt: 10, status: "completed" },
        { id: "b", cwd: "D:\\repo", preview: "B", updatedAt: 20, status: "completed" },
        { id: "c", cwd: "D:\\repo", preview: "C", updatedAt: 30, status: "completed" }
      ]
    }));
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-thread-partitions-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    await requestJson(`${baseUrl}/api/threads/pin`, { method: "POST", body: { cwd: "D:\\repo", threadId: "b" } });
    await requestJson(`${baseUrl}/api/threads/move`, { method: "POST", body: { cwd: "D:\\repo", threadId: "b", targetThreadId: "c" } });
    const listed = await requestJson(`${baseUrl}/api/threads?cwd=${encodeURIComponent("D:\\repo")}`);

    expect(listed.data.data.map((thread: any) => thread.id)).toEqual(["b", "c", "a"]);
  });

  test("persists deleted threads as hidden across refreshed lists", async () => {
    const bridge: any = fakeBridge();
    bridge.listThreads = vi.fn(async () => ({
      data: [
        { id: "a", cwd: "D:\\repo", preview: "A", updatedAt: 10, status: "completed" },
        { id: "b", cwd: "D:\\repo", preview: "B", updatedAt: 20, status: "completed" }
      ]
    }));
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-thread-delete-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    await requestJson(`${baseUrl}/api/threads/a`, { method: "DELETE", body: { cwd: "D:\\repo" } });
    const listed = await requestJson(`${baseUrl}/api/threads?cwd=${encodeURIComponent("D:\\repo")}`);
    const metadata = JSON.parse(await readFile(join(dataDir, "thread-metadata.json"), "utf8"));

    expect(listed.data.data.map((thread: any) => thread.id)).toEqual(["b"]);
    expect(metadata.threads.find((thread: any) => thread.id === "a")).toEqual(expect.objectContaining({ hidden: true }));
    expect(bridge.archiveThread).toHaveBeenCalledWith("a");
  });

  test("quick-creates a project directory under the configured root", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-projects-"));
    const projectRoot = await mkdtemp(join(tmpdir(), "codex-web-root-"));
    tempDirs.push(dataDir, projectRoot);
    const { baseUrl } = await startServer(bridge, events, new ProjectStore(dataDir), { projectRoot });

    const created = await requestJson(`${baseUrl}/api/projects/quick-create`, { method: "POST", body: {} });

    expect(created.data.projects[0]).toEqual(expect.objectContaining({
      cwd: join(projectRoot, "project-1"),
      name: "project-1"
    }));
    const listing = await requestJson(`${baseUrl}/api/fs/list?path=${encodeURIComponent(projectRoot)}`);
    expect(listing.data.entries.some((entry: any) => entry.name === "project-1")).toBe(true);
  });

  test("serves model list and accepts rich turn input", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl } = await startServer(bridge, events);

    const models = await requestJson(`${baseUrl}/api/models?limit=20`);
    await requestJson(`${baseUrl}/api/threads/thread-1/turns`, {
      method: "POST",
      body: {
        input: [
          { type: "text", text: "hello", text_elements: [] },
          { type: "localImage", path: "D:\\shot.png", detail: "high" }
        ],
        overrides: {
          effort: "high",
          approvalPolicy: "never",
          sandboxPolicy: { type: "dangerFullAccess" }
        }
      }
    });

    expect(models.data).toEqual({ data: [{ id: "gpt-test", name: "GPT Test" }], nextCursor: null });
    expect(bridge.listModels).toHaveBeenCalledWith({ limit: 20, includeHidden: undefined, cursor: undefined });
    expect(bridge.startTurnItems).toHaveBeenCalledWith("thread-1", [
      { type: "text", text: "hello", text_elements: [] },
      { type: "localImage", path: "D:\\shot.png", detail: "high" }
    ], {
      effort: "high",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    });
  });

  test("updates skill and plugin configuration", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl } = await startServer(bridge, events);

    await requestJson(`${baseUrl}/api/skills/config`, {
      method: "POST",
      body: { path: "D:\\repo\\.codex\\skills\\x\\SKILL.md", enabled: false }
    });
    await requestJson(`${baseUrl}/api/plugins/config`, {
      method: "POST",
      body: { pluginId: "superpowers@openai-curated", enabled: false }
    });

    expect(bridge.writeSkillConfig).toHaveBeenCalledWith({ path: "D:\\repo\\.codex\\skills\\x\\SKILL.md", enabled: false });
    expect(bridge.writeConfigBatch).toHaveBeenCalledWith({
      edits: [{ keyPath: "plugins.superpowers@openai-curated.enabled", value: false, mergeStrategy: "replace" }],
      reloadUserConfig: true
    });
  });

  test("stores uploaded images and returns local image input metadata", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-upload-data-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    const uploaded = await requestJson(`${baseUrl}/api/uploads/images`, {
      method: "POST",
      body: {
        name: "screen.png",
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8="
      }
    });

    expect(uploaded.data).toEqual(expect.objectContaining({
      input: expect.objectContaining({ type: "localImage", path: expect.stringContaining("screen.png"), detail: "high" }),
      previewUrl: expect.stringMatching(/^\/api\/uploads\/images\//)
    }));
    await expect(readFile(uploaded.data.input.path, "utf8")).resolves.toBe("hello");
  });

  test("stores uploaded non-image files and returns local path metadata", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const dataDir = await mkdtemp(join(tmpdir(), "codex-web-file-upload-data-"));
    tempDirs.push(dataDir);
    const { baseUrl } = await startServer(bridge, events, undefined, { dataDir });

    const uploaded = await requestJson(`${baseUrl}/api/uploads/files`, {
      method: "POST",
      body: {
        name: "proxy-tunnel.ps1",
        mimeType: "text/plain",
        dataUrl: "data:text/plain;base64,V3JpdGUtSG9zdCBoaQ=="
      }
    });

    expect(uploaded.data).toEqual(expect.objectContaining({
      name: "proxy-tunnel.ps1",
      mimeType: "text/plain",
      size: 13,
      path: expect.stringContaining("proxy-tunnel.ps1")
    }));
    await expect(readFile(uploaded.data.path, "utf8")).resolves.toBe("Write-Host hi");
  });

  test("POST /api/threads/:threadId/turns rejects empty text", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl } = await startServer(bridge, events);

    const response = await fetch(`${baseUrl}/api/threads/thread-1/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "" })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual(expect.objectContaining({ ok: false }));
    expect(bridge.startTurn).not.toHaveBeenCalled();
  });

  test("non-api routes do not break backend routing", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl } = await startServer(bridge, events);

    const response = await fetch(`${baseUrl}/missing-ui-route`);

    expect(response.status).toBeLessThan(500);
  });

  test("broadcasts events through /ws", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { baseUrl, port } = await startServer(bridge, events);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve) => ws.once("open", resolve));

    events.append({ type: "note", payload: { from: "test" } });
    await waitFor(() => messages.some((message) => message.type === "event"));
    ws.close();

    expect(baseUrl).toContain("http://127.0.0.1:");
    expect(messages.some((message) => message.type === "event" && message.event.type === "note")).toBe(true);
  });

  test("accepts approval commands through /ws", async () => {
    const bridge = fakeBridge();
    const events = new EventStore();
    const { port } = await startServer(bridge, events);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve) => ws.once("open", resolve));

    try {
      ws.send(JSON.stringify({ type: "approval.approve", requestId: "42", result: { decision: "approved" } }));
      ws.send(JSON.stringify({ type: "approval.reject", requestId: "43", message: "no" }));
      await waitFor(() => bridge.approveServerRequest.mock.calls.length === 1 && bridge.rejectServerRequest.mock.calls.length === 1);
    } finally {
      ws.close();
    }

    expect(bridge.approveServerRequest).toHaveBeenCalledWith("42", { decision: "approved" });
    expect(bridge.rejectServerRequest).toHaveBeenCalledWith("43", "no");
  });
});

function fakeBridge() {
  return {
    listThreads: vi.fn(async () => ({ data: [] })),
    startThread: vi.fn(async () => ({ thread: { id: "thread-1" } })),
    resumeThread: vi.fn(async () => ({ thread: { id: "thread-1" } })),
    readThread: vi.fn(async () => ({ thread: { id: "thread-1", turns: [{ id: "turn-1" }] } })),
    rollbackThread: vi.fn(async () => ({ thread: { id: "thread-1" } })),
    compactThread: vi.fn(async () => ({})),
    forkThread: vi.fn(async () => ({ thread: { id: "thread-branch" } })),
    archiveThread: vi.fn(async () => ({})),
    setThreadGoal: vi.fn(async () => ({ goal: { threadId: "thread-1" } })),
    getThreadGoal: vi.fn(async () => ({ goal: null })),
    clearThreadGoal: vi.fn(async () => ({ removed: true })),
    setThreadName: vi.fn(async () => ({ thread: { id: "thread-1", name: "新标题" } })),
    getConversationSummary: vi.fn(async () => ({ title: "生成标题" })),
    startTurn: vi.fn(async () => ({ turn: { id: "turn-1" } })),
    startTurnItems: vi.fn(async () => ({ turn: { id: "turn-1" } })),
    interruptTurn: vi.fn(async () => ({})),
    steerTurn: vi.fn(async () => ({ turnId: "turn-1" })),
    listSkills: vi.fn(async () => ({ data: [] })),
    listPlugins: vi.fn(async () => ({ data: [] })),
    listMcpServers: vi.fn(async () => ({ data: [] })),
    listModels: vi.fn(async () => ({ data: [{ id: "gpt-test", name: "GPT Test" }], nextCursor: null })),
    readConfig: vi.fn(async () => ({})),
    writeSkillConfig: vi.fn(async () => ({ effectiveEnabled: true })),
    writeConfigBatch: vi.fn(async () => ({ status: "ok" })),
    getPendingServerRequests: vi.fn(() => []),
    approveServerRequest: vi.fn(),
    rejectServerRequest: vi.fn()
  };
}

async function startServer(
  bridge: any,
  events: EventStore,
  projects?: ProjectStore,
  options: { dataDir?: string; projectRoot?: string; codexHome?: string } = {}
): Promise<{ baseUrl: string; port: number }> {
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "codex-web-test-data-"));
  if (!options.dataDir) tempDirs.push(dataDir);
  const { app, attachWebSocket } = createAppServer({
    config: loadConfig({
      CODEX_WEB_DATA_DIR: dataDir,
      CODEX_WEB_PROJECT_ROOT: options.projectRoot,
      CODEX_HOME: options.codexHome
    }),
    bridge,
    events,
    projects: projects ?? new ProjectStore(dataDir),
    themes: new ThemeStore(dataDir),
    threadMetadata: new ThreadMetadataStore(dataDir),
    preferences: new UserPreferencesStore(dataDir),
    status: () => ({ connected: true })
  });
  const server = createServer(app);
  attachWebSocket(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  servers.push({ close: () => new Promise((resolve) => server.close(() => resolve())) });
  return { baseUrl: `http://127.0.0.1:${port}`, port };
}

async function expectJson(url: string, expected: unknown): Promise<void> {
  expect(await requestJson(url)).toEqual(expected);
}

async function requestJson(url: string, options: { method?: string; body?: unknown } = {}): Promise<any> {
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  expect(response.status).toBeLessThan(500);
  return response.json();
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 1000) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, describe, expect, test } from "vitest";
import { listLocalCodexThreads } from "../src/codex/session-history.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("listLocalCodexThreads", () => {
  test("reads Codex rollout files and filters by cwd", async () => {
    const codexHome = await mkdtemp(join(tmpdir(), "codex-web-codex-home-"));
    tempDirs.push(codexHome);
    const sessionDir = join(codexHome, "sessions", "2026", "05", "29");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(join(sessionDir, "rollout-2026-05-29T07-41-48-019e70f7-3103-7e52-b519-5128389b9251.jsonl"), [
      JSON.stringify({
        timestamp: "2026-05-28T23:41:49.956Z",
        type: "session_meta",
        payload: {
          id: "019e70f7-3103-7e52-b519-5128389b9251",
          cwd: "D:\\codex-web\\project-2",
          timestamp: "2026-05-28T23:41:48.721Z"
        }
      }),
      JSON.stringify({
        timestamp: "2026-05-28T23:41:51.859Z",
        type: "event_msg",
        payload: { type: "user_message", message: "你好" }
      })
    ].join("\n"), "utf8");

    const threads = await listLocalCodexThreads({ codexHome, cwd: "D:\\codex-web\\project-2" });

    expect(threads).toEqual([
      expect.objectContaining({
        id: "019e70f7-3103-7e52-b519-5128389b9251",
        cwd: "D:\\codex-web\\project-2",
        preview: "你好",
        status: "completed"
      })
    ]);
  });
});

import express from "express";
import pinoHttpModule from "pino-http";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import type { EventStore } from "./events/event-store.js";
import { attachBrowserWebSocket } from "./http/ws.js";
import { createRoutes, type BridgeLike } from "./http/routes.js";
import { HttpNotifier } from "./notifications/http-notifier.js";
import { attachEventNotifications, NullNotifier } from "./notifications/notifier.js";
import type { ProjectStore } from "./projects/project-store.js";
import type { ThemeStore } from "./themes/theme-store.js";
import type { ThreadMetadataStore } from "./threads/thread-metadata-store.js";
import type { UserPreferencesStore } from "./preferences/user-preferences-store.js";

export interface CreateAppServerOptions {
  config: AppConfig;
  bridge: BridgeLike;
  events: EventStore;
  projects: ProjectStore;
  themes: ThemeStore;
  threadMetadata: ThreadMetadataStore;
  preferences: UserPreferencesStore;
  status: () => unknown;
}

export function createAppServer(options: CreateAppServerOptions): {
  app: express.Express;
  attachWebSocket: (server: Server) => void;
} {
  assertCoreRouteDeps(options);
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  const pinoHttp = (pinoHttpModule as unknown as { default?: (options: unknown) => express.RequestHandler }).default
    ?? (pinoHttpModule as unknown as (options: unknown) => express.RequestHandler);
  app.use(pinoHttp({ enabled: process.env.NODE_ENV !== "test" }));
  app.use(createRoutes(options));
  app.use("/icons", express.static(join(process.cwd(), "icons")));
  const webRoot = resolveWebRoot();
  if (webRoot) {
    app.use(express.static(webRoot));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api/") || req.path === "/health" || req.path === "/ready" || req.path === "/ws") {
        next();
        return;
      }
      res.sendFile(join(webRoot, "index.html"));
    });
  }
  const notifier = options.config.notificationUrl
    ? new HttpNotifier({
      url: options.config.notificationUrl,
      token: options.config.notificationToken,
      targetType: options.config.notificationTargetType,
      targetId: options.config.notificationTargetId,
      source: "codex-web"
    })
    : new NullNotifier();
  attachEventNotifications(options.events, notifier);

  return {
    app,
    attachWebSocket: (server) => {
      attachBrowserWebSocket(server, options.events, options.bridge);
    }
  };
}

function assertCoreRouteDeps(options: CreateAppServerOptions): void {
  const missing = [
    options.projects ? "" : "projects",
    options.themes ? "" : "themes",
    options.threadMetadata ? "" : "threadMetadata",
    options.preferences ? "" : "preferences"
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing required route dependencies: ${missing.join(", ")}`);
  }
}

function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "dist-web"),
    join(here, "..", "dist-web"),
    join(here, "..", "..", "dist-web")
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}

import express, { type Router } from "express";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { errorToHttp } from "../errors.js";
import type { EventStore } from "../events/event-store.js";
import { listLocalCodexThreads } from "../codex/session-history.js";
import { createDirectory, deleteDirectory, listDirectory, listRoots, renameDirectory } from "../fs/local-browser.js";
import type { ProjectStore } from "../projects/project-store.js";
import { listTaskSummaries } from "../tasks/task-index.js";
import type { ThemeStore } from "../themes/theme-store.js";
import type { ThreadMetadataRecord, ThreadMetadataStore } from "../threads/thread-metadata-store.js";
import type { UserPreferencesStore } from "../preferences/user-preferences-store.js";
import { groupThreadsByWorkspace } from "../workspaces/workspace-index.js";

const STALE_RUNNING_TURN_MS = Number(process.env.CODEX_WEB_STALE_RUNNING_TURN_MS ?? 10 * 60 * 1000);

export interface BridgeLike {
  listThreads(input?: { cwd?: string; searchTerm?: string }): Promise<unknown>;
  startThread(input?: Record<string, unknown>): Promise<unknown>;
  resumeThread(threadId: string): Promise<unknown>;
  readThread(threadId: string, includeTurns?: boolean): Promise<unknown>;
  rollbackThread(threadId: string, numTurns: number): Promise<unknown>;
  compactThread(threadId: string): Promise<unknown>;
  forkThread(threadId: string, overrides?: Record<string, unknown>): Promise<unknown>;
  archiveThread(threadId: string): Promise<unknown>;
  setThreadGoal(threadId: string, input: { objective?: string; status?: string; tokenBudget?: number | null }): Promise<unknown>;
  getThreadGoal(threadId: string): Promise<unknown>;
  clearThreadGoal(threadId: string): Promise<unknown>;
  setThreadName(threadId: string, name: string): Promise<unknown>;
  getConversationSummary(threadId: string): Promise<unknown>;
  startTurn(threadId: string, text: string, overrides?: Record<string, unknown>): Promise<unknown>;
  startTurnItems(threadId: string, input: Array<Record<string, unknown>>, overrides?: Record<string, unknown>): Promise<unknown>;
  interruptTurn(threadId: string, turnId: string): Promise<unknown>;
  steerTurn(threadId: string, text: string, expectedTurnId: string): Promise<unknown>;
  listSkills(cwds: string[], forceReload?: boolean): Promise<unknown>;
  listPlugins(): Promise<unknown>;
  listMcpServers(): Promise<unknown>;
  listModels(input?: { cursor?: string; limit?: number; includeHidden?: boolean }): Promise<unknown>;
  readConfig(): Promise<unknown>;
  writeSkillConfig(input: { name?: string; path?: string; enabled: boolean }): Promise<unknown>;
  writeConfigBatch(input: { edits: Array<{ keyPath: string; value: unknown; mergeStrategy: "replace" | "upsert" }>; reloadUserConfig?: boolean }): Promise<unknown>;
  getPendingServerRequests(): unknown[];
  approveServerRequest(requestId: string | number, result: unknown): void;
  rejectServerRequest(requestId: string | number, message: string): void;
}

export interface RouteDeps {
  config: AppConfig;
  bridge: BridgeLike;
  events: EventStore;
  projects: ProjectStore;
  themes: ThemeStore;
  threadMetadata: ThreadMetadataStore;
  preferences: UserPreferencesStore;
  status: () => unknown;
}

export function createRoutes(deps: RouteDeps): Router {
  const router = express.Router();
  const startTurnSchema = z.object({
    text: z.string().trim().min(1).optional(),
    input: z.array(z.record(z.unknown())).optional(),
    overrides: z.record(z.unknown()).optional()
  }).refine((body) => Boolean(body.text) || Boolean(body.input?.length), {
    message: "text or input is required"
  });

  router.get("/health", (_req, res) => res.json({ ok: true }));
  router.get("/ready", (_req, res) => res.json({ ok: true }));
  router.get("/api/status", (_req, res) => {
    interruptStaleRunningTurns(deps);
    ok(res, deps.status());
  });

  router.get("/api/fs/roots", (_req, res) => ok(res, listRoots()));

  router.get("/api/fs/list", asyncHandler(async (req, res) => {
    ok(res, await listDirectory(stringQuery(req.query.path)));
  }));

  router.post("/api/fs/directories", asyncHandler(async (req, res) => {
    const body = z.object({
      parentPath: z.string().trim().min(1),
      name: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await createDirectory(body.parentPath, body.name, await protectedProjectPaths(deps)));
  }));

  router.post("/api/fs/directories/rename", asyncHandler(async (req, res) => {
    const body = z.object({
      path: z.string().trim().min(1),
      name: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await renameDirectory(body.path, body.name, await protectedProjectPaths(deps)));
  }));

  router.post("/api/fs/directories/delete", asyncHandler(async (req, res) => {
    const path = z.string().trim().min(1).parse(req.body?.path);
    ok(res, await deleteDirectory(path, await protectedProjectPaths(deps)));
  }));

  router.get("/api/projects", asyncHandler(async (_req, res) => {
    ok(res, await deps.projects.list());
  }));

  router.get("/api/trash", asyncHandler(async (_req, res) => {
    const archivedThreads = await archivedThreadSummaries(deps);
    ok(res, {
      projects: await deps.projects.listArchived(),
      threads: archivedThreads
    });
  }));

  router.post("/api/projects", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    ok(res, await deps.projects.add(cwd));
  }));

  router.post("/api/projects/rename", asyncHandler(async (req, res) => {
    const body = z.object({
      cwd: z.string().trim().min(1),
      name: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await deps.projects.rename(body.cwd, body.name));
  }));

  router.post("/api/projects/pin", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    ok(res, await deps.projects.pin(cwd));
  }));

  router.post("/api/projects/move", asyncHandler(async (req, res) => {
    const body = z.object({
      cwd: z.string().trim().min(1),
      direction: z.enum(["up", "down"])
    }).parse(req.body ?? {});
    ok(res, await deps.projects.move(body.cwd, body.direction));
  }));

  router.post("/api/projects/delete", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    ok(res, await deps.projects.delete(cwd));
  }));

  router.post("/api/projects/restore", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    ok(res, await deps.projects.restore(cwd));
  }));

  router.post("/api/projects/quick-create", asyncHandler(async (_req, res) => {
    const root = resolve(deps.config.projectRoot, "workspace");
    await mkdir(root, { recursive: true });
    const reservedCwds = new Set([
      ...(await deps.projects.list()).map((project) => project.cwd),
      ...(await deps.projects.listArchived()).map((project) => project.cwd)
    ]);
    for (let index = 1; index < 10000; index += 1) {
      const name = `project-${index}`;
      const cwd = join(root, name);
      if (reservedCwds.has(cwd)) continue;
      try {
        await mkdir(cwd);
        const projects = await deps.projects.add(cwd);
        ok(res, { project: projects.find((project) => project.cwd === cwd), projects });
        return;
      } catch (error: any) {
        if (error?.code === "EEXIST") continue;
        throw error;
      }
    }
    throw new Error("Unable to create a project directory");
  }));

  router.get("/api/themes", asyncHandler(async (_req, res) => {
    ok(res, await deps.themes.list());
  }));

  router.get("/api/preferences", asyncHandler(async (_req, res) => {
    ok(res, await deps.preferences.read());
  }));

  router.put("/api/preferences", asyncHandler(async (req, res) => {
    ok(res, await deps.preferences.update(req.body ?? {}));
  }));

  router.post("/api/themes", asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1),
      css: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await deps.themes.create(body.name, body.css));
  }));

  router.post("/api/themes/delete", asyncHandler(async (req, res) => {
    const id = z.string().trim().min(1).parse(req.body?.id);
    ok(res, await deps.themes.delete(id));
  }));

  router.get("/api/approvals", (_req, res) => ok(res, deps.bridge.getPendingServerRequests()));

  router.get("/api/models", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.listModels({
      limit: numberQuery(req.query.limit),
      cursor: stringQuery(req.query.cursor),
      includeHidden: booleanQuery(req.query.includeHidden)
    }));
  }));

  router.post("/api/uploads/images", asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1),
      mimeType: z.string().trim().regex(/^image\//),
      dataUrl: z.string().trim().min(1)
    }).parse(req.body ?? {});
    const match = /^data:([^;]+);base64,(.+)$/.exec(body.dataUrl);
    if (!match || match[1] !== body.mimeType) {
      res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid image data" } });
      return;
    }
    const safeBaseName = basename(body.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const extension = extname(safeBaseName) || mimeExtension(body.mimeType);
    const filename = `${Date.now()}-${randomUUID()}-${safeBaseName || `image${extension}`}`;
    const uploadDir = resolve(deps.config.dataDir, "uploads", "images");
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, filename);
    await writeFile(filePath, Buffer.from(match[2], "base64"));
    ok(res, {
      input: { type: "localImage", path: filePath, detail: "high" },
      previewUrl: `/api/uploads/images/${encodeURIComponent(filename)}`,
      name: body.name,
      mimeType: body.mimeType
    });
  }));

  router.use("/api/uploads/images", express.static(resolve(deps.config.dataDir, "uploads", "images")));

  router.post("/api/uploads/files", asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1),
      mimeType: z.string().trim().min(1),
      dataUrl: z.string().trim().min(1)
    }).parse(req.body ?? {});
    const match = /^data:([^;]+);base64,(.+)$/.exec(body.dataUrl);
    if (!match || match[1] !== body.mimeType) {
      res.status(400).json({ ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid file data" } });
      return;
    }
    const safeBaseName = basename(body.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `${Date.now()}-${randomUUID()}-${safeBaseName || "upload"}`;
    const uploadDir = resolve(deps.config.dataDir, "uploads", "files");
    await mkdir(uploadDir, { recursive: true });
    const filePath = join(uploadDir, filename);
    const data = Buffer.from(match[2], "base64");
    await writeFile(filePath, data);
    ok(res, {
      name: body.name,
      mimeType: body.mimeType,
      size: data.byteLength,
      path: filePath
    });
  }));

  router.post("/api/approvals/:requestId/approve", (req, res) => {
    deps.bridge.approveServerRequest(param(req.params.requestId), req.body ?? {});
    ok(res, {});
  });

  router.post("/api/approvals/:requestId/reject", (req, res) => {
    deps.bridge.rejectServerRequest(param(req.params.requestId), String(req.body?.message ?? "Rejected by user"));
    ok(res, {});
  });

  router.get("/api/workspaces", asyncHandler(async (_req, res) => {
    const result = await deps.bridge.listThreads({});
    const threads = await mergeBridgeAndLocalThreads(result, {
      codexHome: deps.config.codexHome,
      metadata: await deps.threadMetadata.list()
    });
    ok(res, groupThreadsByWorkspace(threads));
  }));

  router.get("/api/tasks", (req, res) => {
    interruptStaleRunningTurns(deps);
    ok(res, listTaskSummaries(deps.events, {
      threadId: stringQuery(req.query.threadId),
      status: turnStatusQuery(req.query.status)
    }));
  });

  router.get("/api/threads", asyncHandler(async (req, res) => {
    const query = {
      cwd: stringQuery(req.query.cwd),
      searchTerm: stringQuery(req.query.search)
    };
    const result = await deps.bridge.listThreads(query);
    const data = await mergeBridgeAndLocalThreads(result, {
      codexHome: deps.config.codexHome,
      cwd: query.cwd,
      searchTerm: query.searchTerm,
      metadata: await deps.threadMetadata.list(query.cwd)
    });
    ok(res, { ...(isObject(result) ? result : {}), data });
  }));

  router.post("/api/threads/pin", asyncHandler(async (req, res) => {
    const body = z.object({
      cwd: z.string().trim().min(1),
      threadId: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await deps.threadMetadata.pin(body.cwd, body.threadId));
  }));

  router.post("/api/threads/move", asyncHandler(async (req, res) => {
    const body = z.object({
      cwd: z.string().trim().min(1),
      threadId: z.string().trim().min(1),
      targetThreadId: z.string().trim().min(1),
      placement: z.enum(["before", "after"]).optional(),
      orderedThreadIds: z.array(z.string().trim().min(1)).optional()
    }).parse(req.body ?? {});
    if (body.orderedThreadIds?.length) {
      ok(res, await deps.threadMetadata.setOrder(body.cwd, body.orderedThreadIds));
      return;
    }
    ok(res, await deps.threadMetadata.move(body.cwd, body.threadId, body.targetThreadId, body.placement));
  }));

  router.delete("/api/threads/:threadId", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    const threadId = param(req.params.threadId);
    await deps.threadMetadata.delete(cwd, threadId);
    try {
      await deps.bridge.archiveThread(threadId);
    } catch (error) {
      console.warn("Failed to archive Codex thread", error);
    }
    ok(res, { id: threadId, cwd, hidden: true });
  }));

  router.post("/api/threads/:threadId/restore", asyncHandler(async (req, res) => {
    const cwd = z.string().trim().min(1).parse(req.body?.cwd);
    const threadId = param(req.params.threadId);
    await deps.projects.restore(cwd);
    ok(res, await deps.threadMetadata.restore(cwd, threadId));
  }));

  router.post("/api/threads", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.startThread(req.body ?? {}));
  }));

  router.post("/api/threads/:threadId/resume", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.resumeThread(param(req.params.threadId)));
  }));

  router.get("/api/threads/:threadId", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.readThread(param(req.params.threadId), true));
  }));

  router.post("/api/threads/:threadId/turns", asyncHandler(async (req, res) => {
    const body = startTurnSchema.parse(req.body ?? {});
    if (body.input?.length) {
      ok(res, await deps.bridge.startTurnItems(param(req.params.threadId), body.input, body.overrides ?? {}));
      return;
    }
    ok(res, await deps.bridge.startTurn(param(req.params.threadId), body.text!, body.overrides ?? {}));
  }));

  router.post("/api/threads/:threadId/interrupt", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.interruptTurn(param(req.params.threadId), String(req.body?.turnId ?? "")));
  }));

  router.post("/api/threads/:threadId/steer", asyncHandler(async (req, res) => {
    const body = z.object({
      text: z.string().trim().min(1),
      turnId: z.string().trim().min(1)
    }).parse(req.body ?? {});
    ok(res, await deps.bridge.steerTurn(param(req.params.threadId), body.text, body.turnId));
  }));

  router.post("/api/threads/:threadId/rollback", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.rollbackThread(param(req.params.threadId), Number(req.body?.numTurns ?? 1)));
  }));

  router.post("/api/threads/:threadId/rollback-to-turn", asyncHandler(async (req, res) => {
    const threadId = param(req.params.threadId);
    const turnId = z.string().trim().min(1).parse(req.body?.turnId);
    const thread = await deps.bridge.readThread(threadId, true);
    const turns = readTurns(thread);
    const index = turns.findIndex((turn) => String(turn?.id ?? turn?.turnId ?? "") === turnId);
    if (index < 0) {
      res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Turn not found" } });
      return;
    }
    ok(res, await deps.bridge.rollbackThread(threadId, turns.length - index));
  }));

  router.post("/api/threads/:threadId/compact", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.compactThread(param(req.params.threadId)));
  }));

  router.post("/api/threads/:threadId/fork", asyncHandler(async (req, res) => {
    const body = z.object({
      overrides: z.record(z.unknown()).optional()
    }).parse(req.body ?? {});
    ok(res, await deps.bridge.forkThread(param(req.params.threadId), body.overrides ?? {}));
  }));

  router.post("/api/threads/:threadId/goal", asyncHandler(async (req, res) => {
    const body = z.object({
      objective: z.string().trim().min(1).optional(),
      status: z.enum(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]).optional(),
      tokenBudget: z.number().int().positive().nullable().optional()
    }).parse(req.body ?? {});
    ok(res, await deps.bridge.setThreadGoal(param(req.params.threadId), body));
  }));

  router.get("/api/threads/:threadId/goal", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.getThreadGoal(param(req.params.threadId)));
  }));

  router.delete("/api/threads/:threadId/goal", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.clearThreadGoal(param(req.params.threadId)));
  }));

  router.post("/api/threads/:threadId/name", asyncHandler(async (req, res) => {
    const name = z.string().trim().min(1).parse(req.body?.name);
    ok(res, await deps.bridge.setThreadName(param(req.params.threadId), name));
  }));

  router.post("/api/threads/:threadId/title/generate", asyncHandler(async (req, res) => {
    ok(res, await deps.bridge.getConversationSummary(param(req.params.threadId)));
  }));

  router.get("/api/capabilities", asyncHandler(async (req, res) => {
    const cwd = stringQuery(req.query.cwd);
    const cwds = cwd ? [cwd] : [];
    ok(res, {
      skills: await deps.bridge.listSkills(cwds),
      plugins: await deps.bridge.listPlugins(),
      mcpServers: await deps.bridge.listMcpServers(),
      config: await deps.bridge.readConfig(),
      pendingServerRequests: deps.bridge.getPendingServerRequests()
    });
  }));

  router.post("/api/skills/config", asyncHandler(async (req, res) => {
    const body = z.object({
      name: z.string().trim().min(1).optional(),
      path: z.string().trim().min(1).optional(),
      enabled: z.boolean()
    }).refine((value) => Boolean(value.name || value.path), {
      message: "name or path is required"
    }).parse(req.body ?? {});
    ok(res, await deps.bridge.writeSkillConfig(body));
  }));

  router.post("/api/plugins/config", asyncHandler(async (req, res) => {
    const body = z.object({
      pluginId: z.string().trim().min(1),
      enabled: z.boolean()
    }).parse(req.body ?? {});
    ok(res, await deps.bridge.writeConfigBatch({
      edits: [{
        keyPath: `plugins.${body.pluginId}.enabled`,
        value: body.enabled,
        mergeStrategy: "replace"
      }],
      reloadUserConfig: true
    }));
  }));

  router.get("/api/events", (req, res) => {
    ok(res, deps.events.list({
      threadId: stringQuery(req.query.threadId),
      afterSeq: numberQuery(req.query.afterSeq)
    }));
  });

  router.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid request body", issues: error.issues }
      });
      return;
    }
    const mapped = errorToHttp(error);
    res.status(mapped.status).json(mapped.body);
  });

  return router;
}

function ok(res: express.Response, data: unknown): void {
  res.json({ ok: true, data });
}

function asyncHandler(handler: express.RequestHandler): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function numberQuery(value: unknown): number | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanQuery(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function mimeExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".png";
}

function turnStatusQuery(value: unknown): "running" | "completed" | "failed" | "interrupted" | undefined {
  if (value === "running" || value === "completed" || value === "failed" || value === "interrupted") return value;
  return undefined;
}

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

async function protectedProjectPaths(deps: RouteDeps): Promise<string[]> {
  const [projects, archivedProjects] = await Promise.all([
    deps.projects.list(),
    deps.projects.listArchived()
  ]);
  return [...projects, ...archivedProjects].map((project) => project.cwd);
}

async function archivedThreadSummaries(deps: RouteDeps): Promise<any[]> {
  const metadata = await deps.threadMetadata.listArchived();
  if (!metadata.length) return [];
  let localThreads: any[] = [];
  try {
    localThreads = await listLocalCodexThreads({
      codexHome: deps.config.codexHome,
      limit: 1000
    });
  } catch (error) {
    console.warn("Failed to read archived Codex session history", error);
  }
  const localById = new Map(localThreads.map((thread) => [thread.id, thread]));
  return metadata.map((record) => {
    const local = localById.get(record.id);
    return {
      id: record.id,
      cwd: record.cwd,
      preview: local?.preview,
      name: local?.name,
      updatedAt: local?.updatedAt ?? record.updatedAt,
      deletedAt: record.deletedAt,
      pinned: record.pinned,
      order: record.order
    };
  });
}

async function mergeBridgeAndLocalThreads(
  result: unknown,
  input: { codexHome?: string; cwd?: string; searchTerm?: string; metadata?: ThreadMetadataRecord[] }
): Promise<any[]> {
  const bridgeThreads = Array.isArray((result as any)?.data) ? (result as any).data : [];
  let localThreads: any[] = [];
  try {
    localThreads = await listLocalCodexThreads({
      codexHome: input.codexHome,
      cwd: input.cwd,
      searchTerm: input.searchTerm,
      limit: 200
    });
  } catch (error) {
    console.warn("Failed to read local Codex session history", error);
  }
  const byId = new Map<string, any>();
  for (const thread of localThreads) byId.set(thread.id, thread);
  for (const thread of bridgeThreads) byId.set(thread.id, thread);
  const metadataById = new Map((input.metadata ?? []).map((record) => [record.id, record]));
  const hiddenIds = new Set((input.metadata ?? []).filter((record) => record.hidden).map((record) => record.id));
  return [...byId.values()]
    .filter((thread) => !hiddenIds.has(thread.id))
    .map((thread) => {
      const metadata = metadataById.get(thread.id);
      return metadata ? { ...thread, pinned: metadata.pinned, order: metadata.order, hidden: metadata.hidden } : thread;
    })
    .sort((a, b) => compareThreadOrder(a, b));
}

function compareThreadOrder(a: any, b: any): number {
  if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
  const orderA = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
  const orderB = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;
  return Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0);
}

function isObject(input: unknown): input is Record<string, unknown> {
  return Boolean(input && typeof input === "object" && !Array.isArray(input));
}

function interruptStaleRunningTurns(deps: RouteDeps): void {
  deps.events.interruptStaleRunningTurns({
    staleAfterMs: STALE_RUNNING_TURN_MS,
    protectedTurnKeys: pendingApprovalTurnKeys(deps.bridge.getPendingServerRequests())
  });
}

function pendingApprovalTurnKeys(requests: unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const request of requests) {
    const params = isObject(request) ? request.params : undefined;
    if (!isObject(params)) continue;
    const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
    const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
    if (threadId && turnId) keys.add(`${threadId}:${turnId}`);
  }
  return keys;
}

function readTurns(input: unknown): any[] {
  const root = input as any;
  if (Array.isArray(root?.thread?.turns)) return root.thread.turns;
  if (Array.isArray(root?.turns)) return root.turns;
  return [];
}

import type { NotificationMessage, Notifier } from "./notifier.js";

export interface HttpNotifierOptions {
  url: string;
  token?: string;
  targetType?: string;
  targetId?: string;
  source?: string;
  fetchFn?: typeof fetch;
}

export class HttpNotifier implements Notifier {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: HttpNotifierOptions) {
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async notify(message: NotificationMessage): Promise<void> {
    const response = await this.fetchFn(this.options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {})
      },
      body: JSON.stringify({
        target_type: this.options.targetType,
        target_id: this.options.targetId,
        title: message.title,
        message: message.message ?? formatMessage(message),
        source: this.options.source ?? message.source ?? "codex-web"
      })
    });
    if (!response.ok) {
      throw new Error(`Notification request failed with status ${response.status}`);
    }
  }
}

function formatMessage(message: NotificationMessage): string {
  return `${message.type}${message.threadId ? ` thread=${message.threadId}` : ""}${message.turnId ? ` turn=${message.turnId}` : ""}`;
}

import type { BridgeEvent, EventStore } from "../events/event-store.js";

export interface NotificationMessage {
  type: "turn.completed" | "turn.failed" | "turn.interrupted" | "approval.required";
  title: string;
  message?: string;
  threadId?: string;
  turnId?: string;
  source?: string;
}

export interface Notifier {
  notify(message: NotificationMessage): Promise<void>;
}

export class NullNotifier implements Notifier {
  async notify(_message: NotificationMessage): Promise<void> {}
}

export function attachEventNotifications(events: EventStore, notifier: Notifier): () => void {
  return events.subscribe((event) => {
    const message = notificationFromEvent(event);
    if (!message) return;
    void notifier.notify(message);
  });
}

function notificationFromEvent(event: BridgeEvent): NotificationMessage | undefined {
  if (event.type === "turn.completed") {
    const status = (event.payload as any)?.status;
    if (status === "failed") return base(event, "turn.failed", "Codex task failed");
    if (status === "interrupted") return base(event, "turn.interrupted", "Codex task interrupted");
    return base(event, "turn.completed", "Codex task completed");
  }
  if (event.type.startsWith("codex.request.")) {
    return {
      type: "approval.required",
      title: "Codex needs approval",
      message: event.type,
      source: "codex-web"
    };
  }
  return undefined;
}

function base(event: BridgeEvent, type: NotificationMessage["type"], title: string): NotificationMessage {
  return {
    type,
    title,
    threadId: event.threadId,
    turnId: event.turnId,
    source: "codex-web"
  };
}


