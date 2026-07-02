# Notification Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable notification system that sends Codex turn-completion events to multiple channels and exposes the settings in the sidebar.

**Architecture:** Keep Codex app-server event handling in `src/codex`, turn normalization in `src/events`, notification storage and dispatch in `src/notifications`, and UI state in `web/src`. Use one internal completion payload, one store for channel config, and one log for delivery attempts. Preserve the existing `turn.completed` bridge flow and layer notifications on top.

**Tech Stack:** TypeScript, Node.js, Express, JSONL persistence, React, Zod, Vitest.

---

### Task 1: Notification domain model and tests

**Files:**
- Create: `src/notifications/notification-types.ts`
- Create: `tests/notification-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { renderJsonTemplate } from "../src/notifications/notification-types.js";

describe("renderJsonTemplate", () => {
  test("escapes JSON string values for custom webhook templates", () => {
    const output = renderJsonTemplate('{"text":"{{message}}"}', {
      message: 'line 1 "quoted"\nline 2'
    });

    expect(output).toBe('{"text":"line 1 \\"quoted\\"\\nline 2"}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/notification-types.test.ts --run`
Expected: fail because `renderJsonTemplate` is not implemented.

- [ ] **Step 3: Implement minimal code**

Create `src/notifications/notification-types.ts` with the internal completion payload type, channel config types, and a template renderer that JSON-escapes interpolated values.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/notification-types.test.ts --run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notification-types.ts tests/notification-types.test.ts
git commit -m "test: add notification template escaping"
```

### Task 2: Notification store and delivery log

**Files:**
- Create: `src/notifications/notification-store.ts`
- Create: `tests/notification-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { NotificationStore } from "../src/notifications/notification-store.js";

describe("NotificationStore", () => {
  test("persists channel config and preserves disabled channels", async () => {
    const store = new NotificationStore(".data-test");
    await store.write({
      channels: [{ id: "pushplus", type: "pushplus", enabled: false, token: "abc" }],
      customChannels: []
    });

    const result = await store.read();
    expect(result.channels[0].enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/notification-store.test.ts --run`
Expected: fail because the store does not exist.

- [ ] **Step 3: Implement minimal code**

Create JSON-backed storage for channel config and append-only delivery logs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/notification-store.test.ts --run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/notification-store.ts tests/notification-store.test.ts
git commit -m "feat: add notification storage"
```

### Task 3: Channel dispatchers

**Files:**
- Create: `src/notifications/dispatchers.ts`
- Modify: `src/notifications/http-notifier.ts`
- Modify: `src/notifications/notifier.ts`
- Create: `tests/dispatchers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { dispatchNotifications } from "../src/notifications/dispatchers.js";

describe("dispatchNotifications", () => {
  test("sends enabled channels and skips disabled ones", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    await dispatchNotifications(
      { type: "turn.completed", title: "done", message: "m", source: "codex-web" },
      [
        { id: "a", type: "pushplus", enabled: true, token: "1" },
        { id: "b", type: "telegram", enabled: false, botToken: "2", chatId: "3" }
      ],
      { fetchFn }
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/dispatchers.test.ts --run`
Expected: fail because dispatcher logic does not exist yet.

- [ ] **Step 3: Implement minimal code**

Build one dispatcher that routes to built-in adapters and custom webhook adapters.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/dispatchers.test.ts --run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/notifications/dispatchers.ts src/notifications/http-notifier.ts src/notifications/notifier.ts tests/dispatchers.test.ts
git commit -m "feat: add notification dispatchers"
```

### Task 4: Backend wiring

**Files:**
- Modify: `src/config.ts`
- Modify: `src/server.ts`
- Modify: `src/http/routes.ts`
- Create: `tests/notification-routes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

describe("notification config", () => {
  test("loads notification store path and notification defaults", () => {
    const config = loadConfig({ NOTIFICATION_DATA_DIR: "D:\\data" });
    expect(config.notificationDataDir).toBe("D:\\data");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/config.test.ts tests/notification-routes.test.ts --run`
Expected: fail because new config fields and routes do not exist.

- [ ] **Step 3: Implement minimal code**

Add config fields, expose notification CRUD endpoints, and wire the dispatcher into app startup.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/config.test.ts tests/notification-routes.test.ts --run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts src/server.ts src/http/routes.ts tests/config.test.ts tests/notification-routes.test.ts
git commit -m "feat: wire notification config and routes"
```

### Task 5: Sidebar notification settings UI

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`
- Modify: `web/src/components/Sidebar.tsx`
- Modify: `web/src/App.tsx`
- Create: `tests/notification-settings-ui.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Sidebar } from "../web/src/components/Sidebar.js";

describe("notification settings UI", () => {
  test("renders a notification settings section", () => {
    const noop = () => {};
    const html = renderToStaticMarkup(
      <Sidebar
        workspaces={[]}
        activeThreadId={null}
        threadActivityIndicators={{}}
        onSelectWorkspace={noop}
        onSelectThread={noop}
        onAddWorkspace={noop}
        onQuickCreateWorkspace={noop}
        onNewThread={noop}
        onRenameProject={noop}
        onPinProject={noop}
        onMoveProject={noop}
        onDeleteProject={noop}
        onRestoreProject={async () => {}}
        onPinThread={noop}
        onRegenerateThreadTitle={noop}
        onRenameThread={noop}
        onExportThread={noop}
        onDeleteThread={noop}
        onRestoreThread={async () => {}}
        onMoveThread={noop}
        colorMode="dark"
        themes={[]}
        activeThemeId="default"
        onToggleColorMode={noop}
        onSelectTheme={noop}
        onCreateTheme={async () => {}}
        onDeleteTheme={async () => {}}
        collapseToolGroupsByDefault={false}
        onToggleCollapseToolGroupsByDefault={noop}
        approvalDetailsCollapsedByDefault={true}
        onToggleApprovalDetailsCollapsedByDefault={noop}
        renderUserMessagesAsMarkdown={false}
        onToggleRenderUserMessagesAsMarkdown={noop}
        sendBehavior="enter"
        onSendBehaviorChange={noop}
        historyCacheTurnLimit={30}
        onHistoryCacheTurnLimitChange={noop}
        sidebarWidth={286}
        onSidebarWidthChange={noop}
        defaultModel=""
        defaultWorkMode="yolo"
        defaultEffort="medium"
        onDefaultModelChange={noop}
        onDefaultWorkModeChange={noop}
        onDefaultEffortChange={noop}
      />
    );

    expect(html).toContain("通知");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/notification-settings-ui.test.tsx --run`
Expected: fail because the settings nav does not contain `通知`.

- [ ] **Step 3: Implement minimal code**

Add a top-level `通知` settings section, built-in channel toggles, custom channel editor, and delivery history list.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/notification-settings-ui.test.tsx --run`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/types.ts web/src/api.ts web/src/components/Sidebar.tsx web/src/App.tsx tests/notification-settings-ui.test.tsx
git commit -m "feat: add notification settings ui"
```
