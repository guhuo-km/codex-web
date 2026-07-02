# Codex Web Bridge Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first usable backend bridge for a Codex-focused remote Web client.

**Architecture:** A Node/TypeScript HTTP server exposes a protective REST/WebSocket gateway to browsers and phones. Internally it starts or attaches to `codex app-server` on loopback, performs the JSON-RPC initialize handshake, forwards thread/turn/config/MCP/plugin requests, stores live events, tracks background turns, and broadcasts updates to Web clients.

**Tech Stack:** Node.js, TypeScript, Express, ws, Vitest, Zod, pino, Codex `app-server` JSON-RPC.

---

## File Structure

- Create `package.json`: scripts and dependencies for the new backend project.
- Create `tsconfig.json`: strict TypeScript compilation target for Node.
- Create `vitest.config.ts`: Vitest test configuration.
- Create `.env.example`: safe defaults, no secrets.
- Create `src/config.ts`: environment parsing and runtime config.
- Create `src/errors.ts`: typed application errors and HTTP mapping.
- Create `src/events/event-store.ts`: in-memory event/job store for background turns.
- Create `src/codex/json-rpc-client.ts`: websocket JSON-RPC transport, handshake, request routing, notification routing, server-request routing.
- Create `src/codex/app-server-manager.ts`: starts or attaches to local `codex app-server`, token file management, readiness polling, shutdown.
- Create `src/codex/codex-bridge.ts`: high-level methods for threads, turns, skills, plugins, MCP, config, approvals.
- Create `src/http/routes.ts`: REST endpoints for health, bridge status, threads, turns, rollback, interrupt, steer, capabilities, events.
- Create `src/http/ws.ts`: browser WebSocket endpoint for live event fanout and command dispatch.
- Create `src/server.ts`: Express app factory and HTTP/WebSocket wiring.
- Create `src/index.ts`: process entrypoint and graceful shutdown.
- Create `tests/*`: focused unit/integration tests with fake app-server websocket where useful.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`

- [ ] **Step 1: Write scaffold files**

Create scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install express ws zod pino pino-http nanoid dotenv
npm install -D typescript tsx vitest @types/node @types/express @types/ws
```

Expected: `package-lock.json` is created and install exits `0`.

- [ ] **Step 3: Verify scaffold**

Run:

```powershell
npm run build
```

Expected initially: build may fail until `src/index.ts` exists; after Task 2 it must pass.

## Task 2: Config And Errors

**Files:**
- Create: `src/config.ts`
- Create: `src/errors.ts`
- Test: `tests/config.test.ts`
- Test: `tests/errors.test.ts`

- [ ] **Step 1: Write failing config tests**

Test defaults and invalid ports.

- [ ] **Step 2: Run config tests and verify RED**

Run:

```powershell
npm test -- tests/config.test.ts tests/errors.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 3: Implement config and errors**

Config fields:

- `PORT`, default `49380`
- `HOST`, default `0.0.0.0`
- `PUBLIC_BASE_URL`, optional
- `CODEX_BIN`, default `codex`
- `CODEX_HOME`, optional
- `CODEX_APP_SERVER_URL`, optional attach mode
- `CODEX_APP_SERVER_PORT`, default `49317`
- `DATA_DIR`, default `.data`
- `BRIDGE_TOKEN`, optional browser auth
- `ENABLE_EXPERIMENTAL_CODEX_API`, default `true`

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm test -- tests/config.test.ts tests/errors.test.ts
```

Expected: pass.

## Task 3: Event Store And Background Turn Tracking

**Files:**
- Create: `src/events/event-store.ts`
- Test: `tests/event-store.test.ts`

- [ ] **Step 1: Write failing event-store tests**

Cover append, query by thread, running job update on `turn/started`, completion on `turn/completed`, and failure notification events.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/event-store.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement event store**

Use in-memory maps first:

- `append(event)`
- `list({ threadId?, afterSeq? })`
- `recordTurnStart(threadId, turnId)`
- `recordTurnComplete(threadId, turnId, status)`
- `getRunningTurns()`
- `subscribe(listener)`

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- tests/event-store.test.ts
```

Expected: pass.

## Task 4: Codex JSON-RPC Client

**Files:**
- Create: `src/codex/json-rpc-client.ts`
- Test: `tests/json-rpc-client.test.ts`

- [ ] **Step 1: Write failing fake-server tests**

Start a local `ws` server in test. Assert the client:

- Sends `initialize` first.
- Sends `initialized` notification after initialize response.
- Resolves matching request responses.
- Emits notifications.
- Emits server-initiated requests.
- Sends Bearer token header when provided.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/json-rpc-client.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement JSON-RPC client**

Implement:

- `connect()`
- `request(method, params)`
- `notify(method, params?)`
- `respond(id, result)`
- `reject(id, code, message)`
- event callbacks for `notification`, `serverRequest`, `close`

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- tests/json-rpc-client.test.ts
```

Expected: pass.

## Task 5: App Server Manager

**Files:**
- Create: `src/codex/app-server-manager.ts`
- Test: `tests/app-server-manager.test.ts`

- [ ] **Step 1: Write failing manager tests**

Mock `child_process.spawn` and `fetch`. Assert:

- attach mode does not spawn.
- managed mode writes token file and spawns `codex app-server`.
- readiness polling hits `/readyz`.
- shutdown kills the spawned process.

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/app-server-manager.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement manager**

Managed mode command shape:

```powershell
codex app-server --listen ws://127.0.0.1:<port> --ws-auth capability-token --ws-token-file <dataDir>/codex-ws-token.txt
```

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- tests/app-server-manager.test.ts
```

Expected: pass.

## Task 6: Codex Bridge Service

**Files:**
- Create: `src/codex/codex-bridge.ts`
- Test: `tests/codex-bridge.test.ts`

- [ ] **Step 1: Write failing bridge tests**

Use a fake JSON-RPC client. Assert methods call exact Codex methods:

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

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/codex-bridge.test.ts
```

Expected: fail because module does not exist.

- [ ] **Step 3: Implement bridge methods**

The bridge should normalize user text input to:

```json
[{ "type": "text", "text": "...", "text_elements": [] }]
```

It should update `EventStore` from Codex notifications and expose `approveServerRequest` / `rejectServerRequest`.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- tests/codex-bridge.test.ts
```

Expected: pass.

## Task 7: HTTP And Browser WebSocket Gateway

**Files:**
- Create: `src/http/routes.ts`
- Create: `src/http/ws.ts`
- Create: `src/server.ts`
- Create: `src/index.ts`
- Test: `tests/http-routes.test.ts`

- [ ] **Step 1: Write failing route tests**

Use fake bridge. Assert:

- `GET /health`
- `GET /ready`
- `GET /api/status`
- `GET /api/workspaces`
- `GET /api/threads?cwd=...`
- `POST /api/threads`
- `POST /api/threads/:threadId/turns`
- `POST /api/threads/:threadId/interrupt`
- `POST /api/threads/:threadId/steer`
- `POST /api/threads/:threadId/rollback`
- `GET /api/events`

- [ ] **Step 2: Run test and verify RED**

Run:

```powershell
npm test -- tests/http-routes.test.ts
```

Expected: fail because modules do not exist.

- [ ] **Step 3: Implement routes and WebSocket fanout**

REST endpoints return structured JSON:

```json
{ "ok": true, "data": {} }
```

Errors return:

```json
{ "ok": false, "error": { "code": "...", "message": "..." } }
```

Browser WebSocket path: `/ws`.

- [ ] **Step 4: Run test and verify GREEN**

Run:

```powershell
npm test -- tests/http-routes.test.ts
```

Expected: pass.

## Task 8: Verification And Smoke Run

**Files:**
- Modify as needed only when verification exposes defects.

- [ ] **Step 1: Run all tests**

Run:

```powershell
npm test
```

Expected: pass.

- [ ] **Step 2: Build**

Run:

```powershell
npm run build
```

Expected: pass.

- [ ] **Step 3: Start backend**

Run:

```powershell
npm run dev
```

Expected: server listens on configured host/port and `/health` returns `200`.

- [ ] **Step 4: Smoke test**

Run:

```powershell
curl http://127.0.0.1:49380/health
curl http://127.0.0.1:49380/api/status
```

Expected: health succeeds; status reports whether Codex app-server is connected.

## Self-Review

- Spec coverage: Backend bridge, app-server connection, thread/turn APIs, event streaming, background tracking, directory-scoped thread listing, interrupt/rollback/steer, MCP/skills/plugin/config surfaces are covered.
- Placeholder scan: No TBD or vague “handle errors later” steps remain.
- Type consistency: `CodexJsonRpcClient`, `CodexAppServerManager`, `CodexBridge`, and `EventStore` names are consistent across tasks.
