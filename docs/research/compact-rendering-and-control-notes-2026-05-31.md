# Compact Rendering And Control Notes

Date: 2026-05-31

This document is for the next Codex pass after context compaction. It records the investigation and the user's actual requirements. No implementation was done in the discussion that produced this document.

## Project Constraint Reminder

Read `agent.md` before changing UI behavior.

Important rule from `agent.md`: when the user describes a UI issue and the boundary is unclear, ask for concrete trigger conditions and observable behavior. Do not guess and modify unrelated UI while claiming it is fixed.

The user was explicitly unhappy when the discussion drifted into hiding or minimizing compact UI. Do not repeat that. The user wants compact events to be visible.

## Current App-Server Facts Verified

Local Codex version checked during discussion:

```text
codex-cli 0.135.0
```

Generated TypeScript protocol from `codex app-server generate-ts` showed:

- `thread/compact/start` params are only `{ threadId: string }`.
- `thread/compact/start` response is `{}`.
- `ThreadItem` includes `{ type: "contextCompaction", id: string }`.
- `ContextCompactedNotification` exists but is marked deprecated: use `contextCompaction` item instead.
- `NonSteerableTurnKind = "review" | "compact"`.
- `turn/steer` can fail with `activeTurnNotSteerable: { turnKind: "compact" }`.
- `thread/rollback` drops turns by `numTurns`; it does not revert filesystem changes.

Live `thread/read(includeTurns: true)` was run against a real compact thread. A manual compact appeared as a real independent turn:

```json
{
  "id": "019e7d0e-a33e-70e3-9dd2-4e47ccf84715",
  "items": [
    { "type": "contextCompaction", "id": "item-4" }
  ],
  "itemsView": "full",
  "status": "completed",
  "startedAt": 1780214571,
  "completedAt": 1780214589,
  "durationMs": 17608
}
```

There was no `userMessage` item for manual compact. Therefore, if codex-web needs a right-side `/compact` user bubble, codex-web must synthesize it and bind it to the real compact turn.

## Manual Compact Control Facts Verified

A temporary app-server experiment triggered manual compact and immediately tested steer/interrupt.

Result:

- `turn/steer` during manual compact failed with:

```text
cannot steer a compact turn
activeTurnNotSteerable: { turnKind: "compact" }
```

- `turn/interrupt(threadId, compactTurnId)` returned `{}`.
- Reading history after interrupt showed the compact turn status as `interrupted`.

Implications:

- Manual compact can be canceled with `turn/interrupt`.
- Manual compact cannot accept appended/steer messages.
- Manual compact is a real turn and can be removed with `thread/rollback`.

## User Requirements

There are exactly two product cases discussed: automatic compact and manual compact.

### Replace The Current In-Progress Compact UI

The current UI can show a centered in-progress compact marker with horizontal lines:

```text
----------- 上下文压缩中 -----------
```

The user explicitly wants this `上下文压缩中` in-progress marker removed/replaced. This is the UI shown in the screenshot provided during discussion.

Do not interpret this as deleting the completed compact separator. The completed state:

```text
--- 上下文已压缩 ---
```

is still wanted.

The reason for changing only the in-progress marker:

1. The current `上下文压缩中` marker is visually bad.
2. It can coexist with the normal assistant running indicator, producing this broken state:

```text
----------- 上下文压缩中 -----------

ai: -----Codex 工作中 · xx s
```

This must not happen. Context compaction in progress is still AI work, so it must be represented as a special label of the existing running-work UI, not as a separate simultaneous marker.

Manual compact should instead use the target shape below:

- right side: synthesize a full `/compact` user message;
- left side while running: reuse the normal running-turn UI currently used for `Codex 工作中`, but change the label to `正在压缩上下文 · xx s`;
- after completion: show the normal compact completion separator `--- 上下文已压缩 ---`.

### Automatic Compact

The user wants automatic compact to be visibly shown inside the conversation, even if it happens mid-turn during AI work.

Target shape:

```text
用户：帮我检查协议并修复
Codex：工具调用 A/B
---- 上下文已压缩 ----
Codex：工具调用 C/最终回复
```

Purpose: the user must know that the answer after the separator may have been affected by context compaction. This visibility lets the user decide whether to accept the result, roll back to the prior user turn, ask for a lightweight summary, manually compact, and retry.

Do not hide automatic compact as an internal assistant status. Do not silently merge it away.

Automatic compact is different from manual compact:

- It can occur inside an ordinary AI turn.
- It should be rendered in order with surrounding assistant text/tool calls.
- It should not synthesize a right-side `/compact` user bubble.
- It should not block normal steer by itself if the active turn is still a normal AI turn. This was inferred from protocol/source behavior, not live-tested at the exact millisecond of inline auto compact.

### Manual Compact

The user wants manual compact to render like a user-initiated, rollbackable action.

Target shape:

```text
ai: 我已完成xxx
用户: /compact
ai(压缩过程中): -----正在压缩上下文 · xx s
--- 上下文已压缩 ---
用户：帮我去将xx改为xxx
ai（回复过程中）: -----Codex 工作中 · xx s
ai：我先来读取相关文件
    工具调用A
    现在我了解了xxx是由xxx构成的，现在我来更改xxx
    工具调用C、D
    我已完成xxx的修改
```

Requirements:

- The right-side `/compact` message must be present for manual compact.
- That message must be rollbackable.
- Rollback should restore `/compact` into the composer so the user can delete it and send a different message instead.
- During manual compact, the assistant-side running bar should say `正在压缩上下文 · xx s`, not `Codex 工作中`.
- After completion, show the `--- 上下文已压缩 ---` separator.
- Manual compact is not a normal `turn/start` user message in app-server history; codex-web must synthesize the UI message.

## Current Code Problem

Current code turns `contextCompaction` into a `role: "system"` marker:

- `web/src/thread-history.ts`
- `web/src/App.tsx`
- `web/src/codex-normalizers.ts`
- `web/src/components/ChatPane.tsx`

This creates the current incompatible UI: a separator-like system marker can appear after switching away/back, and it can coexist awkwardly with the normal `Codex 工作中` running UI.

Current rollback logic in `web/src/App.tsx` counts user messages:

```ts
function turnsFromUserMessage(messages, userMessageId) {
  const userMessages = messages.filter((message) => message.role === "user");
  const index = userMessages.findIndex((message) => message.id === userMessageId);
  return userMessages.length - index;
}
```

This is wrong for synthesized manual compact unless adjusted, because compact is a real app-server turn without a real app-server user message.

## Recommended Implementation Direction

### Back End

Likely needed:

- Add turn-kind detection for task summaries, at least `kind: "compact" | "normal"` or equivalent.
- Detect compact by observing `item/started` or `item/completed` where item type is `contextCompaction`, keyed by `threadId + turnId`.
- Add a safer rollback endpoint by turn id, e.g. `rollbackToTurn(threadId, turnId)`.
  - It should call `thread/read(includeTurns: true)`.
  - Find the target `turnId` index.
  - Compute `numTurns = turns.length - index`.
  - Call `thread/rollback({ threadId, numTurns })`.
  - Return the updated thread if available.

Do not keep relying on frontend counting user bubbles for compact rollback.

### Front End

Likely needed:

- Add a compact message model instead of treating all compact as generic `systemMarker`.
- For compact-only turns, synthesize:
  - a right-side user message with text `/compact`, bound to the compact turn id;
  - an assistant-side compact running/completed representation;
  - a completion separator `上下文已压缩`.
- For inline `contextCompaction` inside a normal AI turn:
  - render `--- 上下文已压缩 ---` in item order inside the assistant block;
  - do not synthesize a user `/compact` bubble.
- Use the same normalizer for:
  - `thread/read` history;
  - `.data/events.jsonl` replay;
  - live websocket events.

## Compact-During-Input Options Discussed

Manual compact cannot be steered. The user asked for engineering evaluation of two approaches.

Option A: front end disables send during manual compact.

- Smaller change.
- Requires frontend/backend to know current running turn is manual compact.
- Low risk.
- User must send after compact finishes.

Option B: allow the user to press send during manual compact, but queue the text until compact completes.

- Do not call `turn/steer`; app-server rejects compact turns.
- Store one pending user message per thread or append multiple sends by joining with newlines.
- After compact completes, send the merged text as a normal `turn/start`.
- The user should be able to cancel this pending message before it is sent.
- This was initially over-described. Keep it simple if chosen; do not add unrelated model/attachment machinery unless explicitly requested.

The user pushed back against over-defensive design. Avoid expanding scope beyond text queueing unless necessary.

## Deprecated `thread/compacted` Clarification

`thread/compacted` is sent by Codex app-server, not by codex-web, but the protocol marks it deprecated. Current backend wraps app-server notifications as `codex.${method}`, so it would appear as:

```text
codex.thread/compacted
```

The current code also recognizes bare `thread/compacted`. That bare form appears to be old local/test compatibility, not current bridge output.

Suggested stance:

- Prefer `contextCompaction` item.
- Handle `codex.thread/compacted` only if no matching `contextCompaction` exists for the same turn.
- Consider removing bare `thread/compacted` handling/tests unless old `.data/events.jsonl` support is intentionally required.
- Do not let deprecated notification produce duplicate compact UI.

## Do Not Repeat These Mistakes

- Do not say automatic compact should be hidden or reduced to a subtle assistant status.
- Do not assume manual compact has a real app-server `userMessage`.
- Do not use user-message counting as the source of truth for rollback after synthesized compact messages.
- Do not route messages sent during manual compact through `turn/steer`.
- Do not expand the compact queueing discussion into unrelated attachment/model/sandbox complexity unless the user asks.
- Do not implement before aligning the final behavior with the user.

## Files Likely To Touch Later

- `src/codex/codex-bridge.ts`
- `src/http/routes.ts`
- `src/tasks/task-index.ts`
- `web/src/App.tsx`
- `web/src/thread-history.ts`
- `web/src/codex-normalizers.ts`
- `web/src/types.ts`
- `web/src/components/ChatPane.tsx`
- `web/src/components/Composer.tsx`
- tests around `thread-history`, routes, bridge, task summaries, and possibly chat rendering.
