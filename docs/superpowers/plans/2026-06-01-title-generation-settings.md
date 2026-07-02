# Title Generation Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-configurable OpenAI-compatible title generation path so "重新生成标题" uses a dedicated `v1/chat/completions` request and writes the returned title back to the current thread.

**Architecture:** Keep the existing Codex bridge for chat/session control, but add a separate persistent title-generation settings store plus a small backend client that calls an OpenAI-compatible chat completions endpoint. The UI exposes one new settings section for API URL, API key, and model; the backend owns prompt construction, response parsing, title cleanup, and thread renaming so the key never leaves the server.

**Tech Stack:** TypeScript, Express, React, local JSON file persistence, `fetch`, Vitest.

---

### Task 1: Add title-generation persistence and request logic

**Files:**
- Create: `src/title-generation/title-generation-store.ts`
- Create: `src/title-generation/title-generation-service.ts`
- Test: `tests/title-generation-store.test.ts`
- Test: `tests/title-generation-service.test.ts`

- [x] **Step 1: Write the failing test**

Write a store test that reads default settings, updates API URL/model/key, and verifies the public read path never returns the raw key.

Write a service test that sends one `POST` to a normalized `/chat/completions` URL, includes `Authorization: Bearer <key>`, uses a fixed prompt, and extracts a one-line title from the first assistant choice.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/title-generation-store.test.ts tests/title-generation-service.test.ts`
Expected: fail because the store/service files do not exist yet.

- [x] **Step 3: Write minimal implementation**

Implement the JSON-backed settings store and the OpenAI-compatible client.

```ts
export interface TitleGenerationSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export interface PublicTitleGenerationSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  model: string;
  timeoutMs: number;
}
```

Keep the prompt fixed in code. Make title cleanup strip wrapping quotes, collapse whitespace, and clamp to a short single line.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/title-generation-store.test.ts tests/title-generation-service.test.ts`
Expected: PASS.

### Task 2: Wire the backend routes and thread rename flow

**Files:**
- Modify: `src/http/routes.ts`
- Modify: `src/server.ts`
- Modify: `src/index.ts`
- Test: `tests/title-generation-routes.test.ts`

- [x] **Step 1: Write the failing test**

Write a route test that:
- `GET /api/title-generation` returns public settings without the key
- `PUT /api/title-generation` saves URL/key/model
- `POST /api/threads/:threadId/title/generate` loads thread history, generates a title, renames the thread, and returns the title

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/title-generation-routes.test.ts`
Expected: fail because the new route and dependency wiring are missing.

- [x] **Step 3: Write minimal implementation**

Add a `titleGeneration` dependency to the route/server wiring. In the generate handler:
- read the thread with `bridge.readThread(threadId, true)`
- build a fixed prompt from recent thread messages
- call the new service
- call `bridge.setThreadName(threadId, title)`
- return `{ title }`

Keep the old fallback behavior in the UI if the request fails.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/title-generation-routes.test.ts`
Expected: PASS.

### Task 3: Add the settings UI and client calls

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/components/Sidebar.tsx`
- Create: `web/src/components/TitleGenerationSettingsPanel.tsx`
- Modify: `web/src/types.ts`
- Test: `tests/title-generation-ui.test.ts`

- [x] **Step 1: Write the failing test**

Write a render test that checks the new settings panel shows API URL, API key, and model fields, and that the sidebar exposes a new settings section for title generation.

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/title-generation-ui.test.ts`
Expected: fail because the panel and API methods do not exist yet.

- [x] **Step 3: Write minimal implementation**

Add API helpers for reading/updating title-generation settings and triggering title regeneration. Add a new settings subsection beside notifications and keep the API key input masked. Include a save button or explicit clear-key action so the key is not echoed back into the browser state.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/title-generation-ui.test.ts`
Expected: PASS.

### Task 4: Full verification

**Files:**
- All files changed above

- [x] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass.

- [x] **Step 2: Build the app**

Run: `npm run build`
Expected: build succeeds with only the existing Vite chunk-size warning, if any.
