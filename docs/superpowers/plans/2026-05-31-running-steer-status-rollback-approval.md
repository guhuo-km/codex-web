# Running Steer, Status, Rollback, Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add running-turn steer guidance, clearer thread status, rollback/branch message actions, approval prompts, and reasoning rendering to codex-web.

> Execution status: implemented on 2026-05-31. The Codex app-server schema exposes `ModeKind`, `CollaborationMode`, `ThreadSettings`, `turn/plan/updated`, and `item/plan/delta`, but no direct request method for switching collaboration mode was found. The Composer selector is therefore kept as UI/local state and reflects native settings updates when `thread/settings/updated` arrives; it is not injected into `turn/start`.

**Architecture:** Keep Codex app-server protocol handling in `src/codex`, HTTP/WebSocket boundaries in `src/http`, normalized UI data in `web/src/types.ts` and normalizer modules, and visual rendering in focused React components. Treat one user message plus one agent run as one turn; running guidance uses native `turn/steer`, rollback uses native `thread/rollback`, branch uses native `thread/fork`, approvals use existing server-request plumbing.

**Tech Stack:** Node.js, TypeScript, Express, ws, React, Vite, Vitest, Codex app-server JSON-RPC.

---

## Scope

This plan implements:

- Running-turn guidance queue backed by `turn/steer`.
- Thread status dots in the sidebar: completed, running, failed.
- User-message rollback-to-this-turn action.
- Assistant-message branch/fork action.
- Copy icon replacement.
- Native title update and AI title generation route.
- Approval prompt stack above/below the composer using existing pending server requests.
- Reasoning item rendering as small collapsible thinking blocks.
- Stopped/error text shown as a red lightweight line below assistant message actions.
- Conversation goal entry and display in the title/path area.
- Composer mode selector for `Default` / `Plan`, with native trigger path verified before claiming it works.
- Settings entries for default model and default approval/work mode.

This plan does not implement:

- `thread/shellCommand` or `command/exec`.
- Plugin store.
- Hooks UI.
- Full MCP resource/tool browser.
- Full plan/task UI beyond rendering existing plan/reasoning items when present.
- File-system revert for rollback. `thread/rollback` only rolls back conversation history.
- A fake Plan mode. Plan UI must not be marked connected until the app-server trigger path is verified.

## Current State

- `turn/steer` exists in `src/codex/codex-bridge.ts`, `src/http/routes.ts`, and `web/src/api.ts`.
- The current Composer disables the textarea during generation, so steer cannot be used from UI.
- `api.rollback`, `api.approve`, `api.reject`, and `api.steer` exist but are mostly unused from visible UI.
- Pending approvals are exposed by `/api/approvals` and WebSocket hello payload, but React state does not maintain or render them.
- `thread/fork`, `thread/name/set`, and AI title generation are not bridged in `CodexBridge`.
- Reasoning notifications/items exist in app-server schema but are not normalized into `UiAssistantPart`.

## File Structure

- Modify `src/codex/codex-bridge.ts`
  - Add `forkThread`, `setThreadName`, and title-summary helpers.
  - Keep app-server method names isolated here.
- Modify `src/http/routes.ts`
  - Add HTTP routes for fork, native rename, title generation if supported through conversation summary, and optional stronger approval responses.
- Modify `src/http/ws.ts`
  - Include pending requests in updates or add an approval-specific event message.
- Modify `web/src/api.ts`
  - Add `forkThread`, `setThreadName`, `generateThreadTitle`.
- Modify `web/src/types.ts`
  - Add thread status detail, queued steer messages, assistant error/status fields, reasoning assistant parts, pending approval shape extensions.
- Modify `web/src/App.tsx`
  - Own steer queue, approval state, rollback/fork/title behavior, and thread status reconciliation.
- Modify `web/src/components/Composer.tsx`
  - Allow editing while generating.
  - Switch button between stop/send depending on input content.
  - Render queued steer messages below running bar through ChatPane/App data.
  - Add a `Default` / `Plan` mode selector next to the file add button and before the approval/work-mode selector.
- Modify `web/src/components/ChatPane.tsx`
  - Replace disabled message actions with rollback/branch actions.
  - Render queued steer messages, reasoning blocks, and stopped/error lines.
  - Replace copy icon with copy icon shaped like overlapping squares.
- Modify `web/src/components/StatusBar.tsx`
  - Replace the secondary app-server URL line with the current goal summary entry.
  - Open a goal dialog when the goal area is clicked.
- Modify `web/src/components/Sidebar.tsx`
  - Render status dots beside each thread.
  - Add settings controls for default model and default approval/work mode.
- Create or modify focused tests:
  - `tests/codex-bridge.test.ts`
  - `tests/http-routes.test.ts`
  - `tests/approval-routes.test.ts`
  - `tests/thread-history.test.ts`
  - Add `web/src/*.test.ts` if pure helpers are introduced.

---

### Task 1: Bridge Native Thread Actions

**Files:**
- Modify: `src/codex/codex-bridge.ts`
- Modify: `src/http/routes.ts`
- Modify: `web/src/api.ts`
- Test: `tests/codex-bridge.test.ts`
- Test: `tests/http-routes.test.ts`

- [x] **Step 1: Add failing bridge tests**

Add expectations to `tests/codex-bridge.test.ts`:

```ts
await bridge.forkThread("thread-1", 2);
await bridge.setThreadName("thread-1", "新标题");

expect(client.request).toHaveBeenCalledWith("thread/fork", {
  threadId: "thread-1",
  turnIndex: 2
});
expect(client.request).toHaveBeenCalledWith("thread/name/set", {
  threadId: "thread-1",
  name: "新标题"
});
```

Run:

```powershell
npx vitest run tests/codex-bridge.test.ts
```

Expected: fail because `forkThread` and `setThreadName` do not exist.

- [x] **Step 2: Implement bridge methods**

Add to `CodexBridge`:

```ts
forkThread(threadId: string, turnIndex?: number): Promise<unknown> {
  return this.client.request("thread/fork", compactObject({ threadId, turnIndex }));
}

setThreadName(threadId: string, name: string): Promise<unknown> {
  return this.client.request("thread/name/set", { threadId, name });
}
```

If generated schema uses a different fork field than `turnIndex`, verify with generated `ThreadForkParams.ts` before implementation and use the actual field. Do not guess silently.

- [x] **Step 3: Add HTTP routes**

Extend `BridgeLike` in `src/http/routes.ts`:

```ts
forkThread(threadId: string, turnIndex?: number): Promise<unknown>;
setThreadName(threadId: string, name: string): Promise<unknown>;
```

Add routes:

```ts
router.post("/api/threads/:threadId/fork", asyncHandler(async (req, res) => {
  ok(res, await deps.bridge.forkThread(param(req.params.threadId), numberBody(req.body?.turnIndex)));
}));

router.post("/api/threads/:threadId/name", asyncHandler(async (req, res) => {
  const name = z.string().trim().min(1).parse(req.body?.name);
  ok(res, await deps.bridge.setThreadName(param(req.params.threadId), name));
}));
```

Add helper:

```ts
function numberBody(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}
```

- [x] **Step 4: Add frontend API methods**

Add to `web/src/api.ts`:

```ts
forkThread: (threadId: string, turnIndex?: number) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/fork`, {
  method: "POST",
  body: JSON.stringify({ turnIndex })
}),
setThreadName: (threadId: string, name: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/name`, {
  method: "POST",
  body: JSON.stringify({ name })
}),
```

- [x] **Step 5: Verify**

Run:

```powershell
npx vitest run tests/codex-bridge.test.ts tests/http-routes.test.ts
npx tsc -p web/tsconfig.json
```

Expected: pass.

---

### Task 2: Running Steer Queue

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Composer.tsx`
- Modify: `web/src/components/ChatPane.tsx`
- Test: add pure helper tests if queue helpers are extracted.

- [x] **Step 1: Add UI state types**

Add to `UiMessage` or a new thread-level runtime state:

```ts
export interface QueuedSteerMessage {
  id: string;
  text: string;
  status: "queued" | "sent" | "failed";
}
```

Prefer storing by `threadId` in `App.tsx`:

```ts
const [queuedSteers, setQueuedSteers] = useState<Record<string, QueuedSteerMessage[]>>({});
```

- [x] **Step 2: Change Composer rules**

In `Composer.tsx`, allow textarea while generating:

```tsx
<textarea
  value={text}
  disabled={disabled}
  placeholder={disabled ? "请先选择项目" : isDraft ? "请告诉 Codex 需要构建、修改或检查什么..." : "输入消息..."}
/>
```

Define:

```ts
const hasText = text.trim().length > 0;
const canSend = hasText || attachments.length > 0;
const canStop = Boolean(onStop) && isGenerating && !disabled && !hasText && attachments.length === 0;
```

When generating and text exists, `primaryAction()` calls `onSend` as steer, not new turn.

- [x] **Step 3: Add App-level steer behavior**

In `App.tsx`, split send behavior:

```ts
async function sendOrSteer(text: string, attachments: UploadedAttachment[]) {
  if (selectedIsGenerating && activeThreadId) {
    await queueAndSendSteer(activeThreadId, text);
    return;
  }
  await sendMessage(text, attachments);
}
```

Implement:

```ts
async function queueAndSendSteer(threadId: string, text: string) {
  const id = crypto.randomUUID();
  setQueuedSteers((current) => ({
    ...current,
    [threadId]: [...(current[threadId] ?? []), { id, text, status: "queued" }]
  }));
  try {
    await api.steer(threadId, text);
    setQueuedSteers((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).map((item) => item.id === id ? { ...item, status: "sent" } : item)
    }));
  } catch {
    setQueuedSteers((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).map((item) => item.id === id ? { ...item, status: "failed" } : item)
    }));
  }
}
```

- [x] **Step 4: Delete unsent queued steer messages**

Pass `queuedSteers[selectedThread.id]` and delete callback into `ChatPane`.

Only allow deletion when `status === "queued"`:

```ts
function removeQueuedSteer(threadId: string, steerId: string) {
  setQueuedSteers((current) => ({
    ...current,
    [threadId]: (current[threadId] ?? []).filter((item) => item.id !== steerId || item.status !== "queued")
  }));
}
```

- [x] **Step 5: Stop returns queued text to input**

Move Composer draft text state up to `App.tsx` or expose an imperative callback from Composer. Prefer state up:

```ts
const [composerText, setComposerText] = useState("");
```

On stop:

```ts
const unsent = queuedSteers[threadId]?.filter((item) => item.status === "queued") ?? [];
if (unsent.length) {
  setComposerText(unsent.map((item) => item.text).join("\n"));
  setQueuedSteers((current) => ({ ...current, [threadId]: [] }));
}
await api.interrupt(threadId, task.turnId);
```

This preserves the rule: stop is only available when the input box is empty.

- [x] **Step 6: Render queued steer list**

In `ChatPane`, render under `RunningTurnBar`:

```tsx
<div className="steer-queue">
  {queuedSteers.map((item) => (
    <div className={`steer-queue-item ${item.status}`} key={item.id}>
      <span>{item.text}</span>
      {item.status === "queued" ? <button onClick={() => onRemoveQueuedSteer(item.id)}>×</button> : null}
    </div>
  ))}
</div>
```

- [x] **Step 7: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 3: Thread Status Dots

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Sidebar.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Extend UI thread status**

Add:

```ts
export type UiThreadStatus = "completed" | "running" | "failed";
```

Add to `UiThread`:

```ts
status?: UiThreadStatus;
lastError?: string;
```

- [x] **Step 2: Derive status from task/event state**

In `mergeThreadsIntoProjects`, map native summary status:

```ts
status: thread.status === "running" ? "running" : thread.status === "failed" ? "failed" : "completed"
```

When a `turn.completed` event has failed/interrupted status, update thread status accordingly:

```ts
status: eventStatus === "failed" ? "failed" : "completed"
```

Interrupted should render as completed with a red stopped/error line in the message, not as a permanent sidebar red dot unless Codex reports failure.

- [x] **Step 3: Render dot in Sidebar**

Next to each thread title area:

```tsx
<span className={`thread-status-dot ${thread.status ?? "completed"}`} aria-label={threadStatusLabel(thread.status)} />
```

Use the currently empty area near the group edge. Keep it small and quiet.

- [x] **Step 4: Add CSS**

```css
.thread-status-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  flex: 0 0 auto;
}
.thread-status-dot.completed { background: var(--success, #16a34a); }
.thread-status-dot.running { background: var(--warning, #eab308); }
.thread-status-dot.failed { background: var(--danger, #dc2626); }
```

- [x] **Step 5: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 4: Rollback User Turn Action

**Files:**
- Modify: `web/src/components/ChatPane.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/api.ts` only if rollback payload needs turn index.
- Test: add pure helper tests for turn index calculation.

- [x] **Step 1: Replace user reset/more buttons**

In `MessageActions`, if `message.role === "user"`, show:

```tsx
<button type="button" title="回退到这轮" aria-label="回退到这轮" onClick={onRollbackToMessage}>
  <Undo2 size={14} />
</button>
```

Keep copy.

- [x] **Step 2: Confirm menu**

Show a lightweight popover above the button:

```tsx
<div className="message-confirm-popover">
  <span>回退到这轮并清除之后的对话？</span>
  <button type="button" onClick={confirmRollback}>确认</button>
  <button type="button" onClick={cancelRollback}>取消</button>
</div>
```

- [x] **Step 3: Compute rollback count**

In `App.tsx`, derive turns from messages by user messages:

```ts
function turnsAfterUserMessage(messages: UiMessage[], userMessageId: string): number {
  const userMessages = messages.filter((message) => message.role === "user");
  const index = userMessages.findIndex((message) => message.id === userMessageId);
  if (index < 0) return 0;
  return userMessages.length - index - 1;
}
```

Use `api.rollback(threadId, count)` where `count` is turns after clicked user message. If native app-server semantics require rolling back including the clicked turn, adjust only after verifying against schema/live behavior.

- [x] **Step 4: Put clicked user content back into composer**

On confirmation:

```ts
setComposerText(clickedMessage.text);
setComposerAttachments(clickedMessage.attachments ?? []);
```

Clear existing composer text and attachments first.

- [x] **Step 5: Trim local messages**

After native rollback succeeds, trim all messages after the clicked user message:

```ts
messages.slice(0, clickedIndex + 1)
```

Then remove the clicked user message from history if product behavior expects it to become editable input only. Based on the user spec, after rollback the clicked user message should be copied to input for editing; the displayed history should end before that user message's new replacement is sent.

- [x] **Step 6: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 5: Assistant Branch/Fork Action

**Files:**
- Modify: `web/src/components/ChatPane.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Sidebar.tsx` only if generated branch title needs visual distinction.

- [x] **Step 1: Replace assistant reset/more buttons**

For assistant messages, keep copy and show branch:

```tsx
<button type="button" title="从这里创建分支会话" aria-label="创建分支会话" onClick={onForkFromMessage}>
  <GitBranch size={14} />
</button>
```

- [x] **Step 2: Call native fork**

In `App.tsx`:

```ts
async function forkFromMessage(threadId: string, message: UiMessage) {
  const turnIndex = turnIndexForMessage(selectedThread.messages, message.id);
  const result = await api.forkThread(threadId, turnIndex);
  const newThreadId = readPath<string>(result, ["thread", "id"]) ?? readPath<string>(result, ["id"]);
  await refreshProjectsAndThreads();
  if (newThreadId) setActiveThreadId(newThreadId);
}
```

- [x] **Step 3: Distinguish title**

If fork response does not auto-name the thread, locally set:

```ts
const title = `${selectedThread.title} 分支`;
```

If a thread with the same title exists, append ` 2`, ` 3`, etc. Do not leave duplicate names.

- [x] **Step 4: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 6: Approval Prompt Stack

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Composer.tsx` or create `web/src/components/ApprovalStack.tsx`
- Modify: `web/src/styles.css`
- Test: `tests/approval-routes.test.ts`, optional frontend helper tests.

- [x] **Step 1: Maintain pending approval state**

In `App.tsx`:

```ts
const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
```

On WebSocket hello:

```ts
if (Array.isArray(parsed.pendingServerRequests)) setPendingApprovals(parsed.pendingServerRequests);
```

On events:

```ts
if (event.type.startsWith("codex.request.")) refreshApprovals();
if (event.type === "codex.serverRequest/resolved") refreshApprovals();
```

Add:

```ts
async function refreshApprovals() {
  setPendingApprovals(await api.approvals());
}
```

- [x] **Step 2: Create approval stack component**

Create `web/src/components/ApprovalStack.tsx`:

```tsx
export function ApprovalStack({ approvals, onApprove, onReject, onAlwaysAllow }: Props) {
  return (
    <div className="approval-stack">
      {approvals.map((approval) => (
        <section className="approval-card" key={String(approval.id)}>
          <strong>{approvalTitle(approval.method)}</strong>
          <pre>{JSON.stringify(approval.params ?? {}, null, 2)}</pre>
          <div>
            <button onClick={() => onApprove(approval.id)}>批准</button>
            <button onClick={() => onReject(approval.id)}>拒绝</button>
            <button onClick={() => onAlwaysAllow(approval.id)}>总是允许</button>
          </div>
        </section>
      ))}
    </div>
  );
}
```

`总是允许` should initially send the safest app-server-compatible approval object available from current approval params. If Codex expects a specific result shape, verify by live approval event payload before finalizing this button.

- [x] **Step 3: Render near composer**

Place approval stack above the composer input area, not inside message content.

- [x] **Step 4: Connect actions**

In `App.tsx`:

```ts
async function approveRequest(id: string | number, result: unknown = { decision: "approved" }) {
  await api.approve(id, result);
  await refreshApprovals();
}

async function rejectRequest(id: string | number) {
  await api.reject(id, "Rejected by user");
  await refreshApprovals();
}
```

- [x] **Step 5: Verify**

Run:

```powershell
npx vitest run tests/approval-routes.test.ts
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 7: Reasoning Rendering

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/codex-normalizers.ts`
- Modify: `web/src/thread-history.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ChatPane.tsx`
- Test: `tests/thread-history.test.ts`
- Test: `tests/codex-normalizers.test.ts`

- [x] **Step 1: Extend assistant parts**

Add:

```ts
export type UiAssistantPart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; toolCall: UiToolCall }
  | { type: "reasoning"; id: string; text: string; summary?: boolean };
```

- [x] **Step 2: Normalize reasoning items**

Add helper:

```ts
export function normalizeReasoningItem(item: Record<string, unknown>): { id: string; text: string; summary?: boolean } | null {
  if (String(item.type) !== "reasoning") return null;
  const text = firstString(item.text, item.summary, item.content);
  if (!text) return null;
  return { id: String(item.id ?? "reasoning"), text, summary: true };
}
```

- [x] **Step 3: Handle reasoning deltas**

In `App.tsx`, handle:

```ts
codex.item/reasoning/summaryTextDelta
codex.item/reasoning/textDelta
codex.item/reasoning/summaryPartAdded
```

Append to a reasoning part by `itemId`.

- [x] **Step 4: Render collapsible reasoning**

In `ChatPane.tsx`, render small grey collapsible block:

```tsx
<details className="reasoning-block">
  <summary>思考内容</summary>
  <MarkdownContent text={part.text} />
</details>
```

Use smaller text and the same visual language as tool-call collapse, but lighter.

- [x] **Step 5: Verify**

Run:

```powershell
npx vitest run tests/thread-history.test.ts tests/codex-normalizers.test.ts
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 8: Stopped/Error Message Line

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/ChatPane.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Add message status fields**

Add to `UiMessage`:

```ts
statusText?: string;
statusTone?: "danger" | "muted";
```

- [x] **Step 2: Preserve interrupted/failed reason**

When `turn.completed` status is `interrupted`:

```ts
statusText: "已停止生成"
statusTone: "danger"
```

When failed:

```ts
statusText: errorMessageFromEvent(event) ?? "生成失败"
statusTone: "danger"
```

- [x] **Step 3: Render below actions**

In `ChatPane.tsx` under assistant actions:

```tsx
{message.statusText ? <div className={`message-status-line ${message.statusTone ?? "muted"}`}>{message.statusText}</div> : null}
```

- [x] **Step 4: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 9: Title Generation And Native Rename

**Files:**
- Modify: `src/codex/codex-bridge.ts`
- Modify: `src/http/routes.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Sidebar.tsx`
- Test: `tests/http-routes.test.ts`

- [x] **Step 1: Replace local-only rename with native rename**

When user manually edits title:

```ts
await api.setThreadName(threadId, title);
```

Then update local UI.

- [x] **Step 2: Implement regenerate title**

Check whether `getConversationSummary` gives a useful title for a thread. If it does, expose:

```ts
generateThreadTitle(threadId: string): Promise<{ title: string }>
```

If it does not expose title, use the existing local first-message heuristic and do not label it as AI-generated.

- [x] **Step 3: React to native title updates**

Handle `codex.thread/name/updated` event:

```ts
updateThread(cwd, threadId, { title: newName });
```

- [x] **Step 4: Verify**

Run:

```powershell
npx vitest run tests/http-routes.test.ts
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 10: Message Action Icon Cleanup

**Files:**
- Modify: `web/src/components/ChatPane.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Replace copy icon**

Use lucide `Copy` instead of `Clipboard`:

```tsx
import { Copy } from "lucide-react";
```

```tsx
{copied ? <Check size={14} /> : <Copy size={14} />}
```

- [x] **Step 2: Remove disabled reset/more buttons**

Do not leave disabled buttons for unavailable features. Replace with actual rollback/branch buttons from Tasks 4 and 5.

- [x] **Step 3: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 11: Conversation Goal UI

**Files:**
- Modify: `src/codex/codex-bridge.ts`
- Modify: `src/http/routes.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/StatusBar.tsx`
- Modify: `web/src/styles.css`
- Test: `tests/codex-bridge.test.ts`
- Test: `tests/http-routes.test.ts`

- [x] **Step 1: Add bridge methods for native goal**

Extend `CodexBridge`:

```ts
setThreadGoal(input: { threadId: string; objective?: string; status?: string; tokenBudget?: number }): Promise<unknown> {
  return this.client.request("thread/goal/set", compactObject(input));
}

getThreadGoal(threadId: string): Promise<unknown> {
  return this.client.request("thread/goal/get", { threadId });
}

clearThreadGoal(threadId: string): Promise<unknown> {
  return this.client.request("thread/goal/clear", { threadId });
}
```

Run:

```powershell
npx vitest run tests/codex-bridge.test.ts
```

Expected: fail before implementation, pass after implementation.

- [x] **Step 2: Add HTTP routes**

Extend `BridgeLike` in `src/http/routes.ts`:

```ts
setThreadGoal(input: { threadId: string; objective?: string; status?: string; tokenBudget?: number }): Promise<unknown>;
getThreadGoal(threadId: string): Promise<unknown>;
clearThreadGoal(threadId: string): Promise<unknown>;
```

Add routes:

```ts
router.get("/api/threads/:threadId/goal", asyncHandler(async (req, res) => {
  ok(res, await deps.bridge.getThreadGoal(param(req.params.threadId)));
}));

router.post("/api/threads/:threadId/goal", asyncHandler(async (req, res) => {
  const body = z.object({
    objective: z.string().trim().min(1).optional(),
    status: z.string().trim().min(1).optional(),
    tokenBudget: z.number().finite().positive().optional()
  }).parse(req.body ?? {});
  ok(res, await deps.bridge.setThreadGoal({ threadId: param(req.params.threadId), ...body }));
}));

router.post("/api/threads/:threadId/goal/clear", asyncHandler(async (req, res) => {
  ok(res, await deps.bridge.clearThreadGoal(param(req.params.threadId)));
}));
```

- [x] **Step 3: Add frontend API and types**

Add to `web/src/types.ts`:

```ts
export interface ThreadGoal {
  objective?: string;
  status?: string;
  tokenBudget?: number;
  tokensUsed?: number;
  timeUsedSeconds?: number;
}
```

Add to `web/src/api.ts`:

```ts
threadGoal: (threadId: string) => request<ThreadGoal>(`/api/threads/${encodeURIComponent(threadId)}/goal`),
setThreadGoal: (threadId: string, goal: { objective?: string; status?: string; tokenBudget?: number }) => request<ThreadGoal>(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
  method: "POST",
  body: JSON.stringify(goal)
}),
clearThreadGoal: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal/clear`, {
  method: "POST",
  body: JSON.stringify({})
}),
```

- [x] **Step 4: Put goal display in title/path area**

In `StatusBar.tsx`, replace the app-server URL subline with a goal entry:

```tsx
<button className="conversation-goal-entry" type="button" onClick={onOpenGoalDialog}>
  <span>{goal?.objective ? "目标" : "设置目标"}</span>
  <p>{goal?.objective ?? "当前会话未设置目标"}</p>
</button>
```

The target visual location is the existing area under the conversation title, where the app-server URL currently appears.

- [x] **Step 5: Add goal dialog**

Use a modal dialog, not a hover menu:

```tsx
<div className="dialog-backdrop">
  <form className="dialog-panel">
    <header className="dialog-titlebar">
      <h2>设置目标</h2>
      <p>目标会绑定到当前会话，用于持续推进和预算跟踪。</p>
    </header>
    <label>
      目标
      <textarea value={objective} onChange={(event) => setObjective(event.target.value)} />
    </label>
    <label>
      Token 预算
      <input value={tokenBudget} onChange={(event) => setTokenBudget(event.target.value)} inputMode="numeric" />
    </label>
    <footer>
      <button type="button" onClick={onClear}>清除目标</button>
      <button type="button" onClick={onCancel}>取消</button>
      <button type="submit">保存</button>
    </footer>
  </form>
</div>
```

- [x] **Step 6: Handle native goal events**

In `App.tsx`, handle:

```ts
codex.thread/goal/updated
codex.thread/goal/cleared
```

Update local `threadGoals` state by `threadId`.

- [x] **Step 7: Verify**

Run:

```powershell
npx vitest run tests/codex-bridge.test.ts tests/http-routes.test.ts
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 12: Composer Default/Plan Mode Selector

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Composer.tsx`
- Modify: `web/src/styles.css`
- Optional modify after verification: `src/codex/codex-bridge.ts`, `src/http/routes.ts`, `web/src/api.ts`

- [x] **Step 1: Add UI type**

Add to `web/src/types.ts`:

```ts
export type CollaborationModeKind = "default" | "plan";
```

- [x] **Step 2: Add App state**

In `App.tsx`:

```ts
const [collaborationMode, setCollaborationMode] = useState<CollaborationModeKind>("default");
```

Pass `collaborationMode` and `setCollaborationMode` into `Composer`.

- [x] **Step 3: Add selector in Composer**

Place this selector immediately after the `+` file button and before the approval/work-mode selector:

```tsx
<div className="composer-menu-anchor">
  <button className="composer-select-button" type="button" onClick={() => {
    setCollaborationModeOpen((current) => !current);
    setWorkModeOpen(false);
    setModelOpen(false);
    setProjectOpen(false);
    setCapabilityMenuOpen(null);
  }} disabled={disabled || isGenerating} title="协作模式">
    <ListChecks size={15} />
    <span>{collaborationMode === "plan" ? "Plan" : "Default"}</span>
    <ChevronDown size={13} />
  </button>
  {collaborationModeOpen ? (
    <div className="composer-popover mode-menu">
      <button type="button" className={collaborationMode === "default" ? "active" : ""} onClick={() => selectCollaborationMode("default")}>
        <span>Default</span>
        <small>直接执行当前请求</small>
      </button>
      <button type="button" className={collaborationMode === "plan" ? "active" : ""} onClick={() => selectCollaborationMode("plan")}>
        <span>Plan</span>
        <small>先规划，再等待确认或继续</small>
      </button>
    </div>
  ) : null}
</div>
```

- [x] **Step 4: Verify native trigger before connecting**

Before claiming Plan is connected, run a focused protocol check:

```powershell
codex app-server generate-ts --out "$env:TEMP\codex-app-server-schema-plan-check"
rg -n "collaborationMode|ModeKind|plan|thread/settings|settings" "$env:TEMP\codex-app-server-schema-plan-check"
```

Expected:

- If a request method exists for thread settings or collaboration mode, bridge that exact method.
- If no direct method exists, keep the UI selector local and do not alter `turn/start`.
- If slash command injection is the real route, implement it through the future slash-command mapping, not by inventing a `collaborationMode` field.

- [x] **Step 5: Prevent false behavior**

If native trigger is still unknown, show Plan as selectable but not connected only if the user explicitly accepts that behavior. Otherwise keep the selector hidden behind the implementation flag until real trigger is known.

- [x] **Step 6: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

### Task 13: Default Model And Default Approval Settings

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/Sidebar.tsx`
- Modify: `web/src/components/Composer.tsx`
- Modify: `web/src/styles.css`

- [x] **Step 1: Add local settings type**

Add:

```ts
export interface LocalUserDefaults {
  model?: string;
  workMode: WorkMode;
  reasoningEffort: ReasoningEffort;
}
```

- [x] **Step 2: Load defaults in App**

In `App.tsx`:

```ts
function readUserDefaults(): LocalUserDefaults {
  const raw = window.localStorage.getItem("codex-web-user-defaults");
  if (!raw) return { workMode: "yolo", reasoningEffort: "medium" };
  try {
    const parsed = JSON.parse(raw) as Partial<LocalUserDefaults>;
    return {
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      workMode: isWorkMode(parsed.workMode) ? parsed.workMode : "yolo",
      reasoningEffort: isReasoningEffort(parsed.reasoningEffort) ? parsed.reasoningEffort : "medium"
    };
  } catch {
    return { workMode: "yolo", reasoningEffort: "medium" };
  }
}
```

Initialize `workMode`, `model`, and `effort` from these defaults.

- [x] **Step 3: Add settings controls**

In the existing settings dialog in `Sidebar.tsx`, add:

```tsx
<section className="settings-section">
  <h3>默认对话设置</h3>
  <label>
    默认模型
    <select value={defaults.model ?? ""} onChange={(event) => onDefaultModelChange(event.target.value || undefined)}>
      <option value="">使用 Codex 默认模型</option>
      {models.map((model) => <option key={model.id} value={model.id}>{model.name ?? model.id}</option>)}
    </select>
  </label>
  <label>
    默认审批强度
    <select value={defaults.workMode} onChange={(event) => onDefaultWorkModeChange(event.target.value as WorkMode)}>
      <option value="default">默认</option>
      <option value="auto-review">自动审查</option>
      <option value="full-access">完全访问权限</option>
      <option value="yolo">YOLO</option>
    </select>
  </label>
</section>
```

Use wording `默认审批强度` in the UI.

- [x] **Step 4: Apply defaults to new conversations**

When entering a draft or creating a new thread, initialize the composer controls from local defaults. Do not overwrite an already active conversation's manually selected model/work mode while the user is in the middle of composing.

- [x] **Step 5: Persist on blur/change**

Settings controls can persist immediately because these are select controls, not free text inputs:

```ts
window.localStorage.setItem("codex-web-user-defaults", JSON.stringify(nextDefaults));
```

- [x] **Step 6: Verify**

Run:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Expected: pass.

---

## Notifications Notes

Current notification code can emit:

- task completed
- task failed
- task interrupted
- approval required

It is driven by backend events in `src/notifications/notifier.ts`. It does not currently notify for every streamed item, tool output, MCP progress, or warning. That is appropriate for now; noisy notifications would be counterproductive.

## Plan / Task / Todo Clarification

In Codex app-server schema, "plan" means Codex collaboration/planning output:

- `turn/plan/updated`
- `item/plan/delta`
- `ThreadItem` type `plan`
- `CollaborationMode.mode = "plan" | "default"`

It is not the same thing as our internal implementation plan docs, and not necessarily the same as a todo list. Todo rendering should use tool/item data if Codex emits a todo-like item; otherwise it should not be invented.

## Verification Commands

Run after each task that touches backend:

```powershell
npx vitest run tests/codex-bridge.test.ts tests/http-routes.test.ts tests/approval-routes.test.ts
```

Run after each task that touches history/message normalization:

```powershell
npx vitest run tests/thread-history.test.ts tests/codex-normalizers.test.ts
```

Run after each frontend task:

```powershell
npx tsc -p web/tsconfig.json
npm run build:web
```

Run before final handoff:

```powershell
npm test
npm run build:web
```

## Self-Review

Spec coverage:

- Running steer queue: Task 2.
- Stop button behavior and queued return to input: Task 2.
- Error/stopped line: Task 8.
- Sidebar status dots: Task 3.
- Rollback user message action: Task 4.
- Assistant branch/fork action: Task 5.
- Copy icon: Task 10.
- Native title update/generation: Task 9.
- Approval prompts: Task 6.
- Reasoning display: Task 7.
- Goal display and dialog: Task 11.
- Default/Plan mode selector: Task 12.
- Default model and default approval/work-mode settings: Task 13.
- Notifications explanation: Notes section.
- Plan clarification: Notes section.

Placeholder scan:

- The plan intentionally requires live verification for `thread/fork` parameter naming and approval response shape. These are not placeholders; they are protocol checks where guessing would be unsafe.

Type consistency:

- `QueuedSteerMessage`, `UiThreadStatus`, `UiAssistantPart`, and `UiMessage` fields are named consistently across tasks.
- `ThreadGoal`, `CollaborationModeKind`, and `LocalUserDefaults` are named consistently across tasks.
