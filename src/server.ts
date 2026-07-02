import express from "express";
import pinoHttpModule from "pino-http";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./config.js";
import { LocalAuth } from "./auth/local-auth.js";
import type { EventStore } from "./events/event-store.js";
import { attachBrowserWebSocket } from "./http/ws.js";
import { createRoutes, type BridgeLike } from "./http/routes.js";
import { NotificationCenter } from "./notifications/notification-center.js";
import { TitleGenerationService } from "./title-generation/title-generation-service.js";
import { TitleGenerationStore } from "./title-generation/title-generation-store.js";
import { ToolExplanationService } from "./tool-explanations/tool-explanation-service.js";
import { ToolExplanationStore } from "./tool-explanations/tool-explanation-store.js";
import { attachToolExplanationWorker } from "./tool-explanations/tool-explanation-worker.js";
import type { ProjectStore } from "./projects/project-store.js";
import type { ThemeStore } from "./themes/theme-store.js";
import type { ThreadMetadataStore } from "./threads/thread-metadata-store.js";
import type { UserPreferencesStore } from "./preferences/user-preferences-store.js";
import { RuntimeDiagnostics } from "./runtime/diagnostics.js";
import { TerminalManager } from "./terminal/terminal-manager.js";

export interface CreateAppServerOptions {
  config: AppConfig;
  bridge: BridgeLike;
  events: EventStore;
  projects: ProjectStore;
  themes: ThemeStore;
  threadMetadata: ThreadMetadataStore;
  preferences: UserPreferencesStore;
  status: () => unknown;
  diagnostics?: RuntimeDiagnostics;
}

export function createAppServer(options: CreateAppServerOptions): {
  app: express.Express;
  attachWebSocket: (server: Server) => void;
} {
  assertCoreRouteDeps(options);
  const app = express();
  const diagnostics = options.diagnostics ?? new RuntimeDiagnostics(options.events);
  app.use(diagnostics.middleware());
  app.use(express.json({ limit: "5mb" }));
  const pinoHttp = (pinoHttpModule as unknown as { default?: (options: unknown) => express.RequestHandler }).default
    ?? (pinoHttpModule as unknown as (options: unknown) => express.RequestHandler);
  app.use(pinoHttp({ enabled: process.env.NODE_ENV !== "test" }));
  app.use("/icons", express.static(join(process.cwd(), "icons")));
  const auth = new LocalAuth(options.config);
  const notifications = new NotificationCenter(options.config.dataDir);
  const titleGeneration = new TitleGenerationService(new TitleGenerationStore(options.config.dataDir));
  const toolExplanations = new ToolExplanationService(new ToolExplanationStore(options.config.dataDir), titleGeneration);
  const terminals = new TerminalManager();
  notifications.attach(options.events);
  attachToolExplanationWorker(options.events, toolExplanations);
  app.use(auth.router());
  app.use(auth.middleware());
  app.use(createRoutes({ ...options, notifications, titleGeneration, toolExplanations, diagnostics }));
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

  return {
    app,
    attachWebSocket: (server) => {
      attachBrowserWebSocket(server, options.events, options.bridge, { auth, diagnostics, terminals });
    }
  };
}

function assertCoreRouteDeps(options: CreateAppServerOptions): void {
  const missing = [
    options.projects ? "" : "projects",
    options.themes ? "" : "themes",
    options.threadMetadata ? "" : "threadMetadata",
    options.preferences ? "" : "preferences"
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Missing required route dependencies: ${missing.join(", ")}`);
  }
}

function resolveWebRoot(): string | undefined {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "dist-web"),
    join(here, "..", "dist-web"),
    join(here, "..", "..", "dist-web")
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}

