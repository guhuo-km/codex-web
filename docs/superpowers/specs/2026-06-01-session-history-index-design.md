# Session History Index Design

> **Goal:** Stop repeated full scans of Codex rollout files on every thread refresh by introducing a persistent session index with incremental invalidation.

**Architecture:** Add a small indexing layer for local Codex rollout summaries. The index stores per-file metadata and parsed thread summaries so `/api/threads` and archive lookups can reuse prior work, only re-reading rollout files that are new or changed. Keep a bounded read concurrency as a safety net, but make the common path index-first instead of scan-first.

**Tech Stack:** TypeScript, Node.js `fs/promises`, existing Express routes, Vitest.

---

## Problem

`listLocalCodexThreads()` currently discovers rollout files and parses them directly. Even with bounded concurrency, every refresh can still open many files again when the project has a large `.codex` history. On Windows, repeated reads can eventually trigger `EMFILE` and crash the backend.

## Goals

- Reuse parsed rollout summaries across refreshes.
- Avoid reopening unchanged rollout files on every `/api/threads` request.
- Recover cleanly if the index file is missing, stale, or corrupted.
- Keep the existing thread list behavior and response shape unchanged.

## Non-Goals

- No UI changes.
- No schema migration for existing thread metadata stores.
- No attempt to replace Codex rollout files as the source of truth.
- No new user-facing cache controls.

## Design

### 1. Add a session index store

Create a small persistence module under `src/codex/` that owns:

- the cache file path, for example `.data/session-index.json`
- reading/writing the index
- loading index entries into memory
- merging fresh rollout parses back into the index

Each entry should store:

- `id`
- `cwd`
- `preview`
- `name`
- `updatedAt`
- `filePath`
- `mtimeMs`
- `size`

### 2. Index-first thread listing

`listLocalCodexThreads()` should:

1. discover rollout file paths as it already does,
2. read the persisted index,
3. compare each file’s `mtimeMs` and `size` against the cached entry,
4. only parse files that are missing or changed,
5. update the index with fresh summaries,
6. filter/sort/limit the merged summaries as before.

If the index file cannot be read or parsed, treat it as empty and rebuild it.

### 3. Keep bounded concurrency

Keep a conservative concurrency limit for rollout parsing, even after indexing. This is a safety rail, not the main optimization.

### 4. Failure behavior

- A single unreadable rollout file should be skipped, not fail the whole request.
- A corrupt index file should be ignored and recreated.
- Index writes should be best-effort; listing should still succeed if persistence fails.

## Data Flow

1. Frontend requests `/api/threads`.
2. Route calls `bridge.listThreads(...)` and `listLocalCodexThreads(...)` as today.
3. `listLocalCodexThreads()` loads the session index.
4. It stats discovered rollout files, parses only changed files, and merges results.
5. The updated index is written back to disk.
6. The merged thread list is returned to the route.

## Testing

Add tests for:

- repeated calls reusing cached summaries for unchanged rollout files,
- changed rollout files being re-parsed,
- deleted rollout files being removed from the index,
- corrupt index recovery,
- concurrency cap still limiting active file reads.

## Rollout

This is an internal change. No user-facing migration is required. The first request after deployment may rebuild the index once, then subsequent refreshes should become much cheaper.
