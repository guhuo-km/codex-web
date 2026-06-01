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
import type { NotificationCenter } from "../notifications/notification-center.js";
import type { TitleGenerationService } from "../title-generation/title-generation-service.js";
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
  notifications: NotificationCenter;
  titleGeneration: TitleGenerationService;
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

  const titleGenerationSchema = z.object({
    enabled: z.boolean().optional(),
    apiBaseUrl: z.string().trim().optional(),
    apiKey: z.string().trim().optional(),
    model: z.string().trim().optional(),
    timeoutMs: z.number().int().min(1000).max(60000).optional()
  });

  router.get("/api/title-generation", asyncHandler(async (_req, res) => {
    ok(res, await deps.titleGeneration.readPublicSettings());
  }));

  router.put("/api/title-generation", asyncHandler(async (req, res) => {
    const body = titleGenerationSchema.parse(req.body ?? {});
    ok(res, await deps.titleGeneration.updateSettings(body));
  }));

  const builtInChannelSchema = z.object({
    id: z.string().trim().min(1),
    type: z.enum(["pushplus", "telegram", "serverchan", "feishu", "qmsg"]),
    enabled: z.boolean(),
    token: z.string().trim().optional(),
    botToken: z.string().trim().optional(),
    chatId: z.string().trim().optional(),
    sendKey: z.string().trim().optional(),
    webhookUrl: z.string().trim().optional(),
    qmsgKey: z.string().trim().optional()
  });
  const customChannelSchema = z.object({
    id: z.string().trim().min(1),
    type: z.literal("custom"),
    name: z.string().trim(),
    enabled: z.boolean(),
    method: z.string().trim().min(1),
    url: z.string().trim(),
    headers: z.record(z.string()).default({}),
    bodyTemplate: z.string(),
    bodyFormat: z.enum(["text", "json"]).default("text"),
    timeoutMs: z.number().int().min(1000).max(120000).default(10000)
  });

  router.get("/api/notifications", asyncHandler(async (_req, res) => {
    ok(res, await deps.notifications.readSettings());
  }));

  router.put("/api/notifications", asyncHandler(async (req, res) => {
    const body = z.object({
      channels: z.array(builtInChannelSchema).optional(),
      customChannels: z.array(customChannelSchema).optional()
    }).parse(req.body ?? {});
    ok(res, await deps.notifications.updateSettings(body));
  }));

  router.get("/api/notifications/deliveries", asyncHandler(async (req, res) => {
    ok(res, await deps.notifications.listDeliveries(numberQuery(req.query.limit) ?? 50));
  }));

  router.post("/api/notifications/test", asyncHandler(async (req, res) => {
    const body = z.object({
      title: z.string().trim().min(1).optional(),
      message: z.string().trim().optional()
    }).parse(req.body ?? {});
    ok(res, await deps.notifications.dispatch({
      type: "turn.completed",
      status: "completed",
      title: body.title ?? "Codex task completed",
      message: body.message ?? "Notification test",
      threadId: "notification-test",
      turnId: "notification-test",
      source: "codex-web",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
      durationMs: 1000
    }));
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
      indexDataDir: deps.config.dataDir,
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
      indexDataDir: deps.config.dataDir,
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
    const threadId = param(req.params.threadId);
    const thread = await deps.bridge.readThread(threadId, true);
    const title = await deps.titleGeneration.generateTitle({ thread });
    await deps.bridge.setThreadName(threadId, title);
    ok(res, { title });
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
      indexDataDir: deps.config.dataDir,
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
  input: { codexHome?: string; indexDataDir?: string; cwd?: string; searchTerm?: string; metadata?: ThreadMetadataRecord[] }
): Promise<any[]> {
  const bridgeThreads = Array.isArray((result as any)?.data) ? (result as any).data : [];
  let localThreads: any[] = [];
  try {
    localThreads = await listLocalCodexThreads({
      codexHome: input.codexHome,
      indexDataDir: input.indexDataDir,
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
