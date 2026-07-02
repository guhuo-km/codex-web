# Desktop Web UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a desktop-only React Web UI for the existing Codex bridge backend, using RikkaHub Web UI as a reference for layout density, sidebar behavior, bottom input ergonomics, and theme token style.

**Architecture:** Add a Vite React client under `web/`, build it to `dist-web/`, and let the existing Express server serve the compiled static app after API routes. The UI talks to existing `/api/*` REST endpoints and `/ws`; no mobile layout is included in this phase.

**Tech Stack:** Vite, React, TypeScript, Tailwind CSS, Radix UI primitives, lucide-react, Vitest, existing Express backend.

---

## Scope

This plan includes:

- Desktop two-column UI: workspace/thread sidebar and main chat/event workspace.
- REST client for status, workspaces, threads, tasks, events, approvals, turn start, interrupt, steer, rollback.
- WebSocket client for hello snapshots and live event updates.
- RikkaHub-inspired visual language: low-contrast light shell, narrow sidebar, bottom-attached input surface, compact icon buttons, tokenized colors.
- Static file serving from Express after `npm run build`.

This plan excludes:

- Mobile layout and responsive drawer behavior.
- File upload.
- Complex MCP/model pickers.
- Message branching UI.
- A full visual rollback timeline.

---

## File Structure

- Modify `package.json`: add web build/dev scripts and frontend dependencies.
- Create `web/`: Vite React source root.
- Create `web/index.html`: Vite entry HTML.
- Create `web/vite.config.ts`: Vite config with React plugin and output to `../dist-web`.
- Create `web/tsconfig.json`: client TypeScript config.
- Create `web/src/main.tsx`: React bootstrap.
- Create `web/src/App.tsx`: desktop shell, state orchestration, API/WS wiring.
- Create `web/src/api.ts`: typed fetch client and WebSocket URL helper.
- Create `web/src/types.ts`: UI-facing backend types.
- Create `web/src/components/Sidebar.tsx`: workspace/thread/task sidebar.
- Create `web/src/components/ChatPane.tsx`: message/event timeline and approvals.
- Create `web/src/components/Composer.tsx`: bottom input with send/stop/steer controls.
- Create `web/src/components/StatusBar.tsx`: top status strip.
- Create `web/src/styles.css`: Tailwind import and design tokens.
- Modify `src/server.ts`: serve static `dist-web` and SPA fallback when available.
- Create or modify tests for static serving and client build.

---

### Task 1: Install Frontend Toolchain

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [x] **Step 1: Install dependencies**

Run:

```bash
npm install @vitejs/plugin-react vite react react-dom lucide-react @radix-ui/react-dropdown-menu @radix-ui/react-tooltip @radix-ui/react-dialog @radix-ui/react-scroll-area @radix-ui/react-separator clsx tailwind-merge tailwindcss @tailwindcss/vite
npm install -D @types/react @types/react-dom
```

Expected: packages are installed and `package-lock.json` updates.

- [x] **Step 2: Add scripts**

Modify `package.json` scripts to include:

```json
"dev:web": "vite --config web/vite.config.ts",
"build:web": "vite build --config web/vite.config.ts",
"build": "tsc -p tsconfig.json && vite build --config web/vite.config.ts"
```

Keep existing backend scripts.

- [x] **Step 3: Run existing backend tests**

Run:

```bash
npm test
```

Expected: existing tests still pass.

---

### Task 2: Scaffold Vite React Client

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/styles.css`

- [x] **Step 1: Create Vite config**

Create `web/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true
  },
  server: {
    port: 49381,
    proxy: {
      "/api": "http://127.0.0.1:49380",
      "/health": "http://127.0.0.1:49380",
      "/ready": "http://127.0.0.1:49380",
      "/ws": {
        target: "ws://127.0.0.1:49380",
        ws: true
      }
    }
  }
});
```

- [x] **Step 2: Create client TypeScript config**

Create `web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

- [x] **Step 3: Create index HTML**

Create `web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Codex Web</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [x] **Step 4: Create minimal app and styles**

Create `web/src/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

Create `web/src/App.tsx`:

```tsx
export function App() {
  return <div className="app-shell">Codex Web</div>;
}
```

Create `web/src/styles.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light;
  --bg: #f7f4ee;
  --panel: #fffaf3;
  --panel-soft: #eee7dc;
  --text: #29231d;
  --muted: #7c7166;
  --line: #ded5c8;
  --accent: #c9563d;
  --accent-strong: #a93d29;
  --ok: #2f8f5b;
  --warn: #b7791f;
  --bad: #be3b33;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 960px;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.app-shell {
  min-height: 100vh;
}
```

- [x] **Step 5: Build web client**

Run:

```bash
npm run build:web
```

Expected: `dist-web/index.html` exists.

---

### Task 3: API and WebSocket Client

**Files:**
- Create: `web/src/types.ts`
- Create: `web/src/api.ts`

- [x] **Step 1: Create UI types**

Create `web/src/types.ts`:

```ts
export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
}

export interface WorkspaceGroup {
  cwd: string;
  name: string;
  updatedAt: number;
  runningCount: number;
  threads: ThreadSummary[];
}

export interface ThreadSummary {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
  status: string;
}

export interface BridgeEvent {
  seq: number;
  type: string;
  createdAt: string;
  threadId?: string;
  turnId?: string;
  payload: unknown;
}

export interface TaskSummary {
  threadId: string;
  turnId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  startedAt: string;
  completedAt?: string;
  lastEventAt: string;
  lastSeq: number;
  eventCount: number;
}

export interface PendingApproval {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface StatusPayload {
  connected: boolean;
  codexAppServerUrl?: string;
  runningTurns?: TaskSummary[];
}

export interface HelloMessage {
  type: "hello";
  events: BridgeEvent[];
  tasks: TaskSummary[];
  pendingServerRequests: PendingApproval[];
}

export interface EventMessage {
  type: "event";
  event: BridgeEvent;
}

export type WsMessage = HelloMessage | EventMessage;
```

- [x] **Step 2: Create typed API client**

Create `web/src/api.ts`:

```ts
import type { ApiEnvelope, BridgeEvent, PendingApproval, StatusPayload, TaskSummary, ThreadSummary, WorkspaceGroup } from "./types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return (body as ApiEnvelope<T>).data;
}

export const api = {
  status: () => request<StatusPayload>("/api/status"),
  workspaces: () => request<WorkspaceGroup[]>("/api/workspaces"),
  threads: (cwd?: string) => request<{ data?: ThreadSummary[] } | ThreadSummary[]>(`/api/threads${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  thread: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}`),
  tasks: (threadId?: string) => request<TaskSummary[]>(`/api/tasks${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`),
  events: (threadId?: string) => request<BridgeEvent[]>(`/api/events${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`),
  approvals: () => request<PendingApproval[]>("/api/approvals"),
  startThread: (input: { cwd?: string }) => request<any>("/api/threads", { method: "POST", body: JSON.stringify(input) }),
  startTurn: (threadId: string, text: string) => request<any>(`/api/threads/${encodeURIComponent(threadId)}/turns`, { method: "POST", body: JSON.stringify({ text }) }),
  interrupt: (threadId: string, turnId: string) => request<any>(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: JSON.stringify({ turnId }) }),
  steer: (threadId: string, text: string) => request<any>(`/api/threads/${encodeURIComponent(threadId)}/steer`, { method: "POST", body: JSON.stringify({ text }) }),
  rollback: (threadId: string, numTurns: number) => request<any>(`/api/threads/${encodeURIComponent(threadId)}/rollback`, { method: "POST", body: JSON.stringify({ numTurns }) }),
  approve: (requestId: string | number, result: unknown = {}) => request(`/api/approvals/${encodeURIComponent(String(requestId))}/approve`, { method: "POST", body: JSON.stringify(result) }),
  reject: (requestId: string | number, message: string) => request(`/api/approvals/${encodeURIComponent(String(requestId))}/reject`, { method: "POST", body: JSON.stringify({ message }) })
};

export function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
```

- [x] **Step 3: Type-check web client**

Run:

```bash
npx tsc -p web/tsconfig.json
```

Expected: PASS.

---

### Task 4: Desktop Shell Components

**Files:**
- Create: `web/src/components/StatusBar.tsx`
- Create: `web/src/components/Sidebar.tsx`
- Create: `web/src/components/ChatPane.tsx`
- Create: `web/src/components/Composer.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Create StatusBar**

Create `web/src/components/StatusBar.tsx`:

```tsx
import { Circle, RefreshCw } from "lucide-react";
import type { StatusPayload, TaskSummary } from "../types";

interface StatusBarProps {
  status: StatusPayload | null;
  tasks: TaskSummary[];
  onRefresh: () => void;
}

export function StatusBar({ status, tasks, onRefresh }: StatusBarProps) {
  const running = tasks.filter((task) => task.status === "running").length;
  return (
    <header className="status-bar">
      <div className="status-left">
        <span className="brand">Codex Web</span>
        <span className="status-pill">
          <Circle className={status?.connected ? "dot ok" : "dot bad"} />
          {status?.connected ? "Connected" : "Disconnected"}
        </span>
        <span className="status-muted">{status?.codexAppServerUrl ?? "No app-server"}</span>
      </div>
      <div className="status-right">
        <span className="status-pill">{running} running</span>
        <button className="icon-button" type="button" onClick={onRefresh} title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  );
}
```

- [x] **Step 2: Create Sidebar**

Create `web/src/components/Sidebar.tsx`:

```tsx
import { Folder, MessageSquarePlus, PlayCircle } from "lucide-react";
import type { TaskSummary, WorkspaceGroup } from "../types";

interface SidebarProps {
  workspaces: WorkspaceGroup[];
  tasks: TaskSummary[];
  activeThreadId: string | null;
  onSelectThread: (threadId: string, cwd: string) => void;
  onNewThread: (cwd?: string) => void;
}

export function Sidebar({ workspaces, tasks, activeThreadId, onSelectThread, onNewThread }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <button className="primary-action" type="button" onClick={() => onNewThread()}>
          <MessageSquarePlus size={16} />
          New Chat
        </button>
      </div>
      <div className="sidebar-scroll">
        {workspaces.map((workspace) => (
          <section className="workspace-group" key={workspace.cwd}>
            <div className="workspace-title">
              <Folder size={14} />
              <span>{workspace.name}</span>
              {workspace.runningCount > 0 ? <b>{workspace.runningCount}</b> : null}
            </div>
            {workspace.threads.map((thread) => {
              const running = tasks.some((task) => task.threadId === thread.id && task.status === "running");
              return (
                <button
                  key={thread.id}
                  className={thread.id === activeThreadId ? "thread-row active" : "thread-row"}
                  type="button"
                  onClick={() => onSelectThread(thread.id, thread.cwd)}
                >
                  <span className="thread-title">{thread.name || thread.preview || thread.id}</span>
                  {running ? <PlayCircle size={13} /> : null}
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}
```

- [x] **Step 3: Create ChatPane**

Create `web/src/components/ChatPane.tsx`:

```tsx
import { Check, X } from "lucide-react";
import type { BridgeEvent, PendingApproval, TaskSummary } from "../types";

interface ChatPaneProps {
  activeThreadId: string | null;
  events: BridgeEvent[];
  tasks: TaskSummary[];
  approvals: PendingApproval[];
  onApprove: (requestId: string | number) => void;
  onReject: (requestId: string | number) => void;
}

export function ChatPane({ activeThreadId, events, tasks, approvals, onApprove, onReject }: ChatPaneProps) {
  const visibleEvents = activeThreadId ? events.filter((event) => event.threadId === activeThreadId || !event.threadId) : events;
  const visibleTasks = activeThreadId ? tasks.filter((task) => task.threadId === activeThreadId) : tasks;
  return (
    <main className="chat-pane">
      <div className="chat-header">
        <div>
          <h1>{activeThreadId ? "Thread" : "No thread selected"}</h1>
          <p>{activeThreadId ?? "Create or select a thread from the sidebar."}</p>
        </div>
        <div className="task-strip">
          {visibleTasks.slice(0, 3).map((task) => (
            <span className={`task-chip ${task.status}`} key={`${task.threadId}:${task.turnId}`}>
              {task.status} · {task.eventCount}
            </span>
          ))}
        </div>
      </div>

      {approvals.length > 0 ? (
        <div className="approval-stack">
          {approvals.map((approval) => (
            <div className="approval-card" key={String(approval.id)}>
              <div>
                <strong>{approval.method}</strong>
                <p>{JSON.stringify(approval.params ?? {})}</p>
              </div>
              <button className="icon-button positive" type="button" onClick={() => onApprove(approval.id)} title="Approve">
                <Check size={16} />
              </button>
              <button className="icon-button negative" type="button" onClick={() => onReject(approval.id)} title="Reject">
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="event-list">
        {visibleEvents.length === 0 ? (
          <div className="empty-state">No events yet.</div>
        ) : (
          visibleEvents.map((event) => (
            <article className="event-card" key={event.seq}>
              <div className="event-meta">
                <span>{event.type}</span>
                <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
              </div>
              <pre>{formatPayload(event.payload)}</pre>
            </article>
          ))
        )}
      </div>
    </main>
  );
}

function formatPayload(payload: unknown): string {
  if (typeof payload === "string") return payload;
  return JSON.stringify(payload, null, 2);
}
```

- [x] **Step 4: Create Composer**

Create `web/src/components/Composer.tsx`:

```tsx
import { Send, Square, Undo2 } from "lucide-react";
import { useState } from "react";

interface ComposerProps {
  disabled: boolean;
  running: boolean;
  onSend: (text: string) => Promise<void>;
  onStop: () => Promise<void>;
  onRollback: () => Promise<void>;
}

export function Composer({ disabled, running, onSend, onStop, onRollback }: ComposerProps) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const canSend = text.trim().length > 0 && !disabled && !running && !busy;

  async function submit() {
    if (!canSend) return;
    setBusy(true);
    try {
      await onSend(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <footer className="composer-wrap">
      <div className="composer">
        <textarea
          value={text}
          disabled={disabled}
          placeholder={disabled ? "Select a thread first" : "Send a task to Codex..."}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="composer-actions">
          <button className="icon-button" type="button" onClick={() => void onRollback()} disabled={disabled || running} title="Rollback one turn">
            <Undo2 size={16} />
          </button>
          {running ? (
            <button className="send-button stop" type="button" onClick={() => void onStop()} title="Stop">
              <Square size={16} />
            </button>
          ) : (
            <button className="send-button" type="button" disabled={!canSend} onClick={() => void submit()} title="Send">
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </footer>
  );
}
```

- [x] **Step 5: Wire App orchestration**

Replace `web/src/App.tsx` with stateful orchestration that:

- loads status, workspaces, tasks, events, approvals on mount;
- opens `/ws`;
- handles `hello` by replacing events/tasks/approvals;
- handles `event` by appending events and refreshing tasks/approvals/workspaces;
- sends new thread, turn, stop, rollback, approve, reject via `api`.

Use this implementation:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, wsUrl } from "./api";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import type { BridgeEvent, PendingApproval, StatusPayload, TaskSummary, WorkspaceGroup, WsMessage } from "./types";

export function App() {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceGroup[]>([]);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [events, setEvents] = useState<BridgeEvent[]>([]);
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeCwd, setActiveCwd] = useState<string | undefined>();

  const activeRunning = useMemo(
    () => Boolean(activeThreadId && tasks.some((task) => task.threadId === activeThreadId && task.status === "running")),
    [activeThreadId, tasks]
  );

  const refresh = useCallback(async () => {
    const [nextStatus, nextWorkspaces, nextTasks, nextApprovals] = await Promise.all([
      api.status(),
      api.workspaces(),
      api.tasks(),
      api.approvals()
    ]);
    setStatus(nextStatus);
    setWorkspaces(nextWorkspaces);
    setTasks(nextTasks);
    setApprovals(nextApprovals);
    if (activeThreadId) setEvents(await api.events(activeThreadId));
  }, [activeThreadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    ws.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as WsMessage;
      if (parsed.type === "hello") {
        setEvents(parsed.events);
        setTasks(parsed.tasks);
        setApprovals(parsed.pendingServerRequests);
      }
      if (parsed.type === "event") {
        setEvents((current) => [...current, parsed.event]);
        void refresh();
      }
    };
    return () => ws.close();
  }, [refresh]);

  async function createThread(cwd?: string) {
    const response = await api.startThread({ cwd });
    const threadId = response.thread?.id;
    if (threadId) {
      setActiveThreadId(threadId);
      setActiveCwd(cwd);
    }
    await refresh();
  }

  return (
    <div className="app-shell">
      <StatusBar status={status} tasks={tasks} onRefresh={() => void refresh()} />
      <div className="app-body">
        <Sidebar
          workspaces={workspaces}
          tasks={tasks}
          activeThreadId={activeThreadId}
          onSelectThread={(threadId, cwd) => {
            setActiveThreadId(threadId);
            setActiveCwd(cwd);
            void api.events(threadId).then(setEvents);
          }}
          onNewThread={(cwd) => void createThread(cwd ?? activeCwd)}
        />
        <section className="workspace">
          <ChatPane
            activeThreadId={activeThreadId}
            events={events}
            tasks={tasks}
            approvals={approvals}
            onApprove={async (requestId) => {
              await api.approve(requestId);
              await refresh();
            }}
            onReject={async (requestId) => {
              await api.reject(requestId, "Rejected from Codex Web");
              await refresh();
            }}
          />
          <Composer
            disabled={!activeThreadId}
            running={activeRunning}
            onSend={async (text) => {
              if (!activeThreadId) return;
              await api.startTurn(activeThreadId, text);
              await refresh();
            }}
            onStop={async () => {
              const running = tasks.find((task) => task.threadId === activeThreadId && task.status === "running");
              if (!activeThreadId || !running) return;
              await api.interrupt(activeThreadId, running.turnId);
              await refresh();
            }}
            onRollback={async () => {
              if (!activeThreadId) return;
              await api.rollback(activeThreadId, 1);
              await refresh();
            }}
          />
        </section>
      </div>
    </div>
  );
}
```

- [x] **Step 6: Add desktop styling**

Append to `web/src/styles.css` enough styles for the classes used above. Keep `body { min-width: 960px; }` so this phase is explicitly desktop-only. Include sidebar width 292px, top bar height 52px, bottom composer, event cards, approval cards, compact icon buttons, and task chips.

- [x] **Step 7: Build web**

Run:

```bash
npm run build:web
```

Expected: PASS.

---

### Task 5: Serve Built UI from Express

**Files:**
- Modify: `src/server.ts`
- Modify: `tests/http-routes.test.ts`

- [x] **Step 1: Add failing static fallback test**

Extend `tests/http-routes.test.ts` with:

```ts
test("non-api routes do not break backend routing", async () => {
  const bridge = fakeBridge();
  const events = new EventStore();
  const { baseUrl } = await startServer(bridge, events);

  const response = await fetch(`${baseUrl}/missing-ui-route`);

  expect(response.status).toBeLessThan(500);
});
```

This test is intentionally conservative because `dist-web` may not exist in unit tests.

- [x] **Step 2: Implement static serving**

In `src/server.ts`, import:

```ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
```

After `app.use(createRoutes(options));`, add:

```ts
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
```

Add helper:

```ts
function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "dist-web"),
    join(here, "..", "dist-web"),
    join(here, "..", "..", "dist-web")
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}
```

- [x] **Step 3: Run HTTP route tests**

Run:

```bash
npm test -- tests/http-routes.test.ts --run
```

Expected: PASS.

---

### Task 6: Visual Verification and Final Checks

**Files:**
- No code changes unless verification exposes failures.

- [x] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [x] **Step 2: Run full build**

Run:

```bash
npm run build
```

Expected: backend TypeScript and web build pass.

- [x] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Expected: server listens on configured port. Keep it running for browser verification.

- [x] **Step 4: Inspect UI in browser**

Open `http://127.0.0.1:49380/` and verify:

- desktop shell loads;
- sidebar is visible;
- top status bar shows connection state;
- composer is bottom-attached;
- no text overlap at 1365x768;
- event cards are readable;
- approval cards fit if present.

- [x] **Step 5: Screenshot check**

Use browser screenshot after loading the page. Confirm page is not blank and layout is desktop-only with no mobile drawer.
