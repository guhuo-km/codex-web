# Notification Delivery Design

**Goal:** Add a backend notification pipeline for Codex turn completion events, plus a settings UI to configure multiple channels and custom webhook templates.

**Architecture:** Codex app-server notifications remain the source of truth. `turn/completed` is the primary trigger, with `thread/tokenUsage/updated` merged in as optional context and `thread/closed` treated as a separate lifecycle event, not the default completion signal. The backend will normalize all completion-style events into one internal payload, dispatch it through channel adapters, and persist delivery history separately from user preferences.

**Tech Stack:** TypeScript, Node.js, Express, JSONL persistence, React, Zod, Vitest.

---

## Scope

This feature adds:

- a new top-level `通知` settings section in the sidebar
- per-channel enable/disable switches
- built-in channels for PushPlus, Telegram, Server酱, 飞书机器人, and Qmsg
- multiple custom webhook channels
- delivery logging and retry-free best-effort dispatch

## Event Model

The backend listens to local bridge events and converts them into an internal notification payload:

- `turn.completed` with status `completed` -> success notification
- `turn.completed` with status `failed` -> failure notification
- `turn.completed` with status `interrupted` -> interrupted notification
- `thread/tokenUsage/updated` -> attached if already known for the same thread/turn
- `thread/closed` -> tracked separately, not emitted as the default "AI finished" signal

The payload includes:

- `type`
- `status`
- `title`
- `message`
- `threadId`
- `turnId`
- `startedAt`
- `completedAt`
- `durationMs`
- `tokenUsage`
- `errorMessage`
- `source`

## Channel Model

Each built-in channel has:

- `enabled`
- one small config block for its credentials

Custom channels have:

- `enabled`
- `name`
- `method`
- `url`
- `headers`
- `bodyTemplate`
- `timeoutMs`

Multiple custom channels are allowed.

## Template Rules

Custom channel templates must be safe for JSON payloads.

- Plain text interpolation is allowed for text bodies.
- JSON bodies must escape substituted values correctly.
- Template variables include `{{title}}`, `{{message}}`, `{{status}}`, `{{threadId}}`, `{{turnId}}`, `{{durationMs}}`, `{{errorMessage}}`, and `{{tokenUsage.*}}`.
- Missing fields render as empty strings, not `undefined`.

This is required because some custom channels will send literal JSON request bodies.

## Storage

Notification configuration is stored outside normal UI preferences because it contains secrets and channel-specific payloads.

- `user-preferences.json` remains for visual/UI preferences only
- `notifications.json` stores channel config and enablement
- `notification-deliveries.jsonl` stores delivery attempts and results

## UI

The settings dialog gets a new top-level `通知` section with subpanels for:

- built-in channels
- custom channels
- delivery history

The channel list must support add/remove for custom channels and independent enable toggles for every channel.

## Acceptance Criteria

- A completed Codex turn triggers dispatch to every enabled channel.
- Failed and interrupted turns are distinguishable in outbound payloads.
- Channels can be toggled independently without deleting their configuration.
- Multiple custom channels can coexist.
- Custom templates correctly escape JSON values.
- Delivery attempts are recorded with success/failure metadata.
- The current UI settings remain intact.

