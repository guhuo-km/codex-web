# Codex App-Server Mechanisms Research

Date: 2026-05-30

Codex CLI version checked locally: `codex-cli 0.135.0`

Primary sources:

- Local schema generated with `codex app-server generate-ts --out %TEMP%/codex-app-server-schema-0.135-deep-research`
- Current bridge code in `src/codex/*`, `src/http/routes.ts`, `web/src/thread-history.ts`
- Official app-server README: https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md

## 1. Mental Model

`codex app-server` is not the TUI. It is Codex's rich-client protocol server.

The protocol exposes three core objects:

- `Thread`: one conversation/session. It has `id`, `cwd`, `createdAt`, `updatedAt`, `status`, `path`, `name`, and `turns`.
- `Turn`: one user request and one agent run. It has `id`, `items`, `status`, `startedAt`, `completedAt`, `durationMs`.
- `ThreadItem`: ordered units inside a turn. This is where user messages, assistant text, reasoning, command execution, file changes, MCP calls, web search, image view/generation, context compaction, and collab agent calls live.

Important implication for codex-web:

- A single user message maps to one `turn`.
- One `turn` can contain many assistant text items and many tool items.
- UI must render one "AI reply block" per turn, but preserve the internal item order inside that block.
- Tool calls are not separate conversations and not separate assistant replies.

## 2. Transport And Lifecycle

Supported transports from the official README:

- `stdio` / `stdio://`: default JSONL transport.
- `ws://IP:PORT`: one JSON-RPC message per WebSocket text frame, documented as experimental / unsupported.
- `unix://`: WebSocket over Unix socket.
- `off`: no local transport.

Our current project uses WebSocket:

- Starts Codex with `codex app-server --listen ws://127.0.0.1:49317 --ws-auth capability-token --ws-token-file ...`.
- Then connects with a JSON-RPC WebSocket client.
- Sends `initialize` first, then `initialized`.
- Initializes with `capabilities.experimentalApi: true`.

Official lifecycle:

1. Connect transport.
2. `initialize`.
3. `initialized` notification.
4. `thread/start` or `thread/resume`.
5. `turn/start`.
6. Listen for `turn/*`, `item/*`, `thread/*` notifications.
7. `turn/completed` ends that run.

## 3. Client Requests Exposed By Schema

Generated `ClientRequest.ts` currently exposes 84 request methods.

### Thread And Conversation

Available:

- `thread/start`: create a new thread.
- `thread/resume`: reopen an existing thread by id.
- `thread/fork`: branch a stored thread into a new thread id.
- `thread/archive`, `thread/unarchive`, `thread/unsubscribe`
- `thread/name/set`
- `thread/list`
- `thread/loaded/list`
- `thread/read`
- `thread/rollback`
- `thread/compact/start`
- `thread/inject_items`
- `thread/metadata/update`
- `thread/shellCommand`
- `thread/approveGuardianDeniedAction`

Notable behavior:

- `thread/read` can load stored history without resuming it.
- `thread/resume` continues a thread.
- `thread/fork` is the correct primitive for "branch from history" if we want a new conversation.
- `thread/rollback` drops turns from the end of the thread history, but does not revert filesystem changes.
- `thread/compact/start` starts manual context compaction and reports progress via normal turn/item events.

Product implications:

- We can support native rename via `thread/name/set`; current web title metadata can later be reconciled with native thread names.
- We can support archive/delete-like UI via `thread/archive` instead of only hiding locally.
- We can support rollback, but must explicitly explain "conversation history rollback only; file changes are not reverted".
- We can support fork/branch if the UX ever needs "continue from here as new conversation".
- We should avoid pretending rollback equals TUI double-Esc unless we fully map the same UX.

### Turn Control

Available:

- `turn/start`
- `turn/steer`
- `turn/interrupt`

`turn/start` supports:

- `threadId`
- `input`
- `cwd`
- `approvalPolicy`
- `approvalsReviewer`
- `sandboxPolicy`
- `model`
- `serviceTier`
- `effort`
- `summary`
- `personality`
- `outputSchema`

Product implications:

- Stop button should call `turn/interrupt`.
- "追加指导/steer" is possible while a turn is running.
- Work mode/model/effort should be sent as turn overrides.
- These overrides become defaults for subsequent turns on the same thread according to schema comments.

### Models And Config

Available:

- `model/list`
- `modelProvider/capabilities/read`
- `config/read`
- `config/value/write`
- `config/batchWrite`
- `configRequirements/read`
- `experimentalFeature/list`
- `experimentalFeature/enablement/set`
- `permissionProfile/list`

Product implications:

- Model selector should be populated by `model/list`, not hardcoded.
- Each model reports `displayName`, `description`, `supportedReasoningEfforts`, `defaultReasoningEffort`, `inputModalities`, `serviceTiers`, `isDefault`.
- Capability badges can come from `modelProvider/capabilities/read`: `namespaceTools`, `imageGeneration`, `webSearch`.
- Permission mode UI can eventually use `permissionProfile/list`, not only legacy sandbox values.

### Filesystem Utilities

Available:

- `fs/readDirectory`
- `fs/readFile`
- `fs/writeFile`
- `fs/createDirectory`
- `fs/getMetadata`
- `fs/remove`
- `fs/copy`
- `fs/watch`
- `fs/unwatch`

All paths must be absolute. File data is base64.

Product implications:

- Our project picker currently uses our own local filesystem code. We could move it onto native app-server `fs/*`.
- Native `fs/watch` can support live project tree refresh.
- Since these operate on the app-server host filesystem, a VPS-hosted app-server would see the VPS filesystem, not the user's LAN PC.

### Standalone Command Execution

Available:

- `command/exec`
- `command/exec/write`
- `command/exec/terminate`
- `command/exec/resize`

Capabilities:

- Run argv commands outside a thread/turn.
- Optional `processId` enables streaming and follow-up control.
- `tty: true` enables terminal-style interaction.
- `streamStdoutStderr: true` streams output via `command/exec/outputDelta`.
- `command/exec/terminate` can kill a running command.
- These output notifications are connection-scoped; if the connection closes, app-server terminates the process.

Product implications:

- A terminal panel is possible.
- Background independent commands are possible only while our bridge's app-server connection stays alive.
- For persistent background tasks across browser disconnects, codex-web must keep its backend process and WS connection alive and store command state.

### Thread Shell Command

Available:

- `thread/shellCommand`

Official README says this is for TUI `!` workflow and runs unsandboxed with full access. It does not inherit the thread sandbox policy.

Product implications:

- We can expose a "run shell command in this thread" feature later.
- It should be visibly dangerous because it bypasses thread sandbox.

### MCP, Plugins, Skills, Hooks

Available:

- `skills/list`
- `skills/config/write`
- `hooks/list`
- `plugin/list`
- `plugin/read`
- `plugin/skill/read`
- `plugin/install`
- `plugin/uninstall`
- marketplace/share/install management endpoints
- `mcpServerStatus/list`
- `mcpServer/resource/read`
- `mcpServer/tool/call`
- `mcpServer/oauth/login`
- `config/mcpServer/reload`

Skill invocation:

- Text can include `$<skill-name>`.
- Better: include a `UserInput` item `{ type: "skill", name, path }` so the backend injects exact skill instructions.

MCP status includes:

- server `name`
- `tools`
- `resources`
- `resourceTemplates`
- `authStatus`

MCP call item includes:

- `server`
- `tool`
- `arguments`
- `status`
- `result`
- `error`
- `durationMs`

Product implications:

- Skills and plugins can be displayed and toggled more explicitly.
- We can show MCP auth errors before the user sends a message.
- Tool-call UI should support MCP calls, not only shell commands.
- We can build a "capability panel" per project/thread.

### Auth And Account

Available:

- `account/read`
- `account/login/start`
- `account/login/cancel`
- `account/logout`
- `account/rateLimits/read`
- `account/sendAddCreditsNudgeEmail`
- `getAuthStatus`
- token refresh server request: `account/chatgptAuthTokens/refresh`

Product implications:

- A full remote web client can surface login state, ChatGPT login flow, API key mode, and rate limits.
- For this project, credentials stay on the machine running app-server.

### Review, Apps, External Agents, Feedback

Available:

- `review/start`
- `app/list`
- `externalAgentConfig/detect`
- `externalAgentConfig/import`
- `feedback/upload`

Product implications:

- Review mode is native and should not be faked.
- App/external-agent config may be useful later, but is not needed for current conversation UI.

## 4. Server Notifications

Generated `ServerNotification.ts` exposes 65 notification methods.

### Thread Lifecycle

- `thread/started`
- `thread/status/changed`
- `thread/archived`
- `thread/unarchived`
- `thread/closed`
- `thread/name/updated`
- `thread/settings/updated`
- `thread/tokenUsage/updated`
- `thread/goal/updated`
- `thread/goal/cleared`
- `thread/compacted`

Product implications:

- We should update title from `thread/name/updated`.
- Token display should use `thread/tokenUsage/updated`.
- Running/completed status should not rely only on local optimistic state.

### Turn Lifecycle

- `turn/started`
- `turn/completed`
- `turn/diff/updated`
- `turn/plan/updated`

`Turn` includes:

- `startedAt`
- `completedAt`
- `durationMs`
- final `items`
- `status`
- optional `error`

Product implications:

- AI work time should come from `turn.startedAt`, `turn.completedAt`, `durationMs` when available.
- While streaming, codex-web can compute elapsed time locally from `turn/started`.
- Diff panel can be powered by `turn/diff/updated`.
- Plan UI can be powered by `turn/plan/updated` if we later expose plan mode/slash commands.

### Item Lifecycle

- `item/started`
- `item/completed`

Every significant unit inside a turn should render from these:

- `userMessage`
- `agentMessage`
- `plan`
- `reasoning`
- `commandExecution`
- `fileChange`
- `mcpToolCall`
- `dynamicToolCall`
- `collabAgentToolCall`
- `webSearch`
- `imageView`
- `imageGeneration`
- `enteredReviewMode`
- `exitedReviewMode`
- `contextCompaction`

Product implications:

- The message renderer should be item-order based.
- Do not merge all tools into one blob.
- Default collapsed/expanded state should be a UI choice per item.

### Streaming Text And Reasoning

- `item/agentMessage/delta`: streaming assistant text. Concatenate deltas by `itemId`.
- `item/plan/delta`: streaming plan text.
- `item/reasoning/summaryTextDelta`: readable reasoning summary stream.
- `item/reasoning/summaryPartAdded`: boundary between reasoning summary sections.
- `item/reasoning/textDelta`: raw reasoning text for models that expose it.

Product implications:

- Streaming markdown should use delta accumulation by item id.
- The full visible assistant reply is the ordered sequence of text parts and tool parts in one turn.
- Reasoning should be displayed as collapsible thinking/summary parts, not as normal assistant text.

### Tool Output Streams

- `item/commandExecution/outputDelta`: stdout/stderr for command execution inside a turn.
- `item/commandExecution/terminalInteraction`: terminal interaction events.
- `item/fileChange/patchUpdated`: structured patch snapshots.
- `item/fileChange/outputDelta`: deprecated.
- `item/mcpToolCall/progress`: progress message for MCP tool call.
- `command/exec/outputDelta`: standalone command output.
- `process/outputDelta`, `process/exited`: present in docs, but not present in our generated 0.135 stable/experimental schema request list.

Product implications:

- Tool cards should update live before final `item/completed`.
- For command cards, final item has `aggregatedOutput`, `exitCode`, `durationMs`; streaming deltas should be merged until final state arrives.
- For file edits, `patchUpdated` is the better source for live diff display.

### Warnings And Errors

- `error`
- `warning`
- `guardianWarning`
- `configWarning`
- `deprecationNotice`
- `model/rerouted`
- `model/verification`
- `windows/worldWritableWarning`
- `windowsSandbox/setupCompleted`

Product implications:

- Errors/warnings should become visible event cards or status banners.
- Model reroute/verification should annotate the affected turn/message.

## 5. Server-Initiated Requests

Generated `ServerRequest.ts` exposes 10 request methods. These are JSON-RPC requests from app-server to the client; the client must respond or reject.

### Approval Requests

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- legacy `applyPatchApproval`
- legacy `execCommandApproval`

Command approval includes:

- `threadId`
- `turnId`
- `itemId`
- `startedAtMs`
- `reason`
- `command`
- `cwd`
- parsed `commandActions`
- proposed exec/network policy amendments

Permission approval can request additional filesystem/network permissions and can be granted for the turn or session.

Product implications:

- Approval UI can be precise: command, cwd, parsed action, reason, network/file permission request.
- YOLO mode can auto-respond to these requests, but it should be explicit and visibly dangerous.
- Auto-review mode should set `approvalsReviewer: "auto_review"` rather than implementing our own fake reviewer first.

### User Input And MCP Elicitation

- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`

Product implications:

- Codex can ask the user structured questions mid-turn.
- MCP servers can request forms or URL-based flows.
- The current codex-web does not have a complete mid-turn input form system yet.

### Dynamic Tool Calls

- `item/tool/call`

This is for app-client-defined dynamic tools. The flow is:

1. `item/started` with `dynamicToolCall`.
2. `item/tool/call` request to the client.
3. Client responds with content items.
4. `item/completed` with final dynamic tool result.

Product implications:

- codex-web can eventually expose custom client-side tools to Codex.
- This is the formal way to let the web app implement extra capabilities, rather than injecting text hacks.

## 6. Inputs Supported By `turn/start`

Generated `UserInput` supports only:

- `{ type: "text", text, text_elements: [] }`
- `{ type: "image", url, detail? }`
- `{ type: "localImage", path, detail? }`
- `{ type: "skill", name, path }`
- `{ type: "mention", name, path }`

No generic `file` attachment exists.

Product implications:

- Images should use native `localImage` or URL `image`.
- Generic documents/scripts should be saved by codex-web to a local temporary path and referenced in a text input.
- Skills should be sent as explicit `skill` input items when possible.
- Mentions can be supported later if we map file/entity mention UI.

## 7. Permissions, Sandbox, Work Modes

### Thread Start

`thread/start` accepts legacy:

- `approvalPolicy`
- `approvalsReviewer`
- `sandbox`

`sandbox` values:

- `read-only`
- `workspace-write`
- `danger-full-access`

### Turn Start

`turn/start` accepts:

- `approvalPolicy`
- `approvalsReviewer`
- `sandboxPolicy`

`sandboxPolicy` shapes:

- `{ type: "dangerFullAccess" }`
- `{ type: "readOnly", networkAccess: boolean }`
- `{ type: "workspaceWrite", writableRoots: string[], networkAccess: boolean, excludeTmpdirEnvVar: boolean, excludeSlashTmp: boolean }`
- `{ type: "externalSandbox", networkAccess: ... }`

`approvalPolicy` includes:

- `untrusted`
- `on-failure`
- `on-request`
- `never`
- granular object variant

`approvalsReviewer` includes:

- `user`
- `auto_review`
- `guardian_subagent`

Product mapping:

- 默认: send no override.
- 自动审查: `approvalsReviewer: "auto_review"`.
- 完全访问权限: full sandbox, but approval policy can still ask depending on policy.
- YOLO: `approvalPolicy: "never"` plus full sandbox; optionally auto-approve remaining server requests if app-server still emits them.

## 8. Goal, Plan, Review

Goal is native:

- `thread/goal/set`
- `thread/goal/get`
- `thread/goal/clear`

Goal has:

- `objective`
- `status`
- `tokenBudget`
- `tokensUsed`
- `timeUsedSeconds`

Plan is represented in settings/events/items:

- `CollaborationMode.mode = "plan" | "default"`
- `turn/plan/updated`
- `ThreadItem` type `plan`
- `item/plan/delta`

But current 0.135 generated `thread/start` and `turn/start` do not expose a direct `collaborationMode` field. This likely needs slash-command behavior, config mutation, or another app-server method not in the generated request list.

Review is native:

- `review/start`
- `enteredReviewMode`
- `exitedReviewMode`

Product implications:

- Goal UI can be real.
- Plan toggle should not be faked until we map the native route.
- Review mode can be implemented as a native action.

## 9. Background Behavior

There are three meanings of "background":

1. Browser tab closed, codex-web backend still running.
   - Supported by our architecture.
   - Backend WebSocket to app-server remains alive.
   - Events continue to be stored in `.data`.

2. codex-web backend exits, Codex turn keeps running.
   - Not guaranteed.
   - If app-server process or its client connection is terminated, connection-scoped operations may stop.
   - A loaded/running thread may be rejoinable via `thread/resume`, but do not design around guaranteed survival without testing.

3. Standalone `command/exec` process continues after app-server connection closes.
   - Official schema says command output notifications are connection-scoped; docs say connection close terminates the process.
   - So persistent background command execution requires codex-web backend to stay alive.

Product implications:

- Our backend should be the durable coordinator.
- Browser should be disposable.
- For long tasks, persist events and turn jobs, then rehydrate UI after reconnect.

## 10. Current codex-web Coverage

Already connected:

- Managed app-server startup over local WebSocket.
- `initialize` with experimental API.
- `thread/list`, `thread/start`, `thread/resume`, `thread/read`, `thread/rollback`.
- `turn/start`, rich input items, `turn/interrupt`, `turn/steer`.
- `skills/list`, `plugin/list`, `mcpServerStatus/list`, `model/list`, `config/read`.
- Server request storage/approve/reject.
- Local project store, theme store, thread pin/order metadata.
- Local upload: images as `localImage`, generic files as text path injection.
- Event persistence in `.data` JSONL.
- Partial message hydration from `thread/read` and persisted events.
- Partial tool rendering for `commandExecution`.

Not yet connected or incomplete:

- Native `thread/name/set`.
- Native `thread/archive` / `thread/unarchive`.
- Native `thread/fork`.
- Native `thread/compact/start`.
- Native `thread/goal/*`.
- Native `review/start`.
- Native `thread/shellCommand`.
- Native `fs/*` and `fs/watch`.
- Native `command/exec` terminal panel.
- Native `mcpServer/resource/read` and `mcpServer/tool/call`.
- Native plugin read/install/uninstall and skill config writes.
- Dynamic tool server-request handling.
- Structured approval UI for every request type.
- Full item renderer for `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `webSearch`, `imageGeneration`, `reasoning`, `plan`, warnings/errors.
- Token usage and final timing should be consistently rendered from native turn/token notifications.

## 11. Recommended Feature Buckets For codex-web

### Bucket A: Conversation Core

- Correct one-turn-one-AI-block renderer.
- Ordered item timeline inside each AI block.
- Live stream text by `itemId`.
- Stop via `turn/interrupt`.
- Steer via `turn/steer`.
- Native title updates via `thread/name/updated` and `thread/name/set`.

### Bucket B: Tool Visibility

- `commandExecution` card with command, cwd, status, output, exit code, duration.
- `fileChange` card with changed paths and diff.
- `mcpToolCall` card with server/tool/arguments/result/error.
- `dynamicToolCall` card.
- `webSearch` card.
- `imageView` / `imageGeneration` card.
- Reasoning summary collapsible block.

### Bucket C: Safety And Permissions

- Full approval queue UI.
- Granular command/file/permission/MCP elicitation forms.
- Auto-review mode using native `approvalsReviewer`.
- YOLO mode as explicit full-access/no-approval mode.

### Bucket D: Session Management

- Archive/unarchive.
- Fork/branch.
- Rollback with file-change caveat.
- Compact.
- Goal.
- Search/filter by cwd/source/archive.

### Bucket E: Project And File UX

- Move file browser to native `fs/*`.
- Add `fs/watch`.
- Upload image as `localImage`.
- Upload generic files by temp path injection.
- Mention picker via `mention` input item.

### Bucket F: Terminal / Background Jobs

- Native terminal panel using `command/exec` with `tty`.
- Stream output via `command/exec/outputDelta`.
- Write stdin, resize, terminate.
- Persist process metadata in codex-web while backend remains alive.

### Bucket G: Capability Management

- Models from `model/list`.
- Provider capabilities from `modelProvider/capabilities/read`.
- Skills from `skills/list`, explicit `skill` input injection.
- Plugins via plugin read/install/uninstall.
- MCP status and OAuth flow.

## 12. High-Risk Areas

- WebSocket transport is documented as experimental/unsupported.
- Experimental API fields can change; our bridge must tolerate unknown/missing methods.
- App-server schema is version-specific; regenerate on Codex upgrades.
- `thread/rollback` does not revert files.
- `thread/shellCommand` runs unsandboxed.
- Generic file attachments are not native; path injection is a codex-web convention.
- Current bridge stores all notifications generically, but frontend currently understands only part of `ThreadItem`.

