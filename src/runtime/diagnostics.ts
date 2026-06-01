import type express from "express";
import type { EventStore } from "../events/event-store.js";

export interface RuntimeDiagnosticsOptions {
  startedAt?: Date;
}

export interface RuntimeDiagnosticsSnapshot {
  startedAt: string;
  uptimeMs: number;
  memory: NodeJS.MemoryUsage;
  http: {
    totalRequests: number;
    recentRequestsPerMinute: number;
    inFlightRequests: number;
    byRoute: Array<{
      key: string;
      method: string;
      path: string;
      count: number;
      errorCount: number;
      averageDurationMs: number;
      lastStatusCode?: number;
      lastDurationMs?: number;
      lastSeenAt?: string;
    }>;
  };
  websocket: {
    activeConnections: number;
    totalConnections: number;
    messagesSent: number;
    helloEventsSent: number;
  };
  events: ReturnType<EventStore["stats"]>;
  persistence?: Record<string, unknown>;
}

interface RouteStats {
  method: string;
  path: string;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  lastStatusCode?: number;
  lastDurationMs?: number;
  lastSeenAt?: string;
}

export class RuntimeDiagnostics {
  private readonly startedAt: Date;
  private totalRequests = 0;
  private inFlightRequests = 0;
  private readonly recentRequestTimestamps: number[] = [];
  private readonly routes = new Map<string, RouteStats>();
  private activeWebSockets = 0;
  private totalWebSockets = 0;
  private messagesSent = 0;
  private helloEventsSent = 0;

  constructor(private readonly events: EventStore, options: RuntimeDiagnosticsOptions = {}) {
    this.startedAt = options.startedAt ?? new Date();
  }

  middleware(): express.RequestHandler {
    return (req, res, next) => {
      const started = Date.now();
      this.totalRequests += 1;
      this.inFlightRequests += 1;
      this.recentRequestTimestamps.push(started);
      res.on("finish", () => {
        this.inFlightRequests = Math.max(0, this.inFlightRequests - 1);
        const durationMs = Date.now() - started;
        const path = routePath(req);
        const key = `${req.method} ${path}`;
        const stats = this.routes.get(key) ?? {
          method: req.method,
          path,
          count: 0,
          errorCount: 0,
          totalDurationMs: 0
        };
        stats.count += 1;
        if (res.statusCode >= 500) stats.errorCount += 1;
        stats.totalDurationMs += durationMs;
        stats.lastStatusCode = res.statusCode;
        stats.lastDurationMs = durationMs;
        stats.lastSeenAt = new Date().toISOString();
        this.routes.set(key, stats);
        this.pruneRecentRequests(Date.now());
      });
      next();
    };
  }

  recordWebSocketOpen(): void {
    this.activeWebSockets += 1;
    this.totalWebSockets += 1;
  }

  recordWebSocketClose(): void {
    this.activeWebSockets = Math.max(0, this.activeWebSockets - 1);
  }

  recordWebSocketSend(eventCount = 0): void {
    this.messagesSent += 1;
    this.helloEventsSent += eventCount;
  }

  async snapshot(): Promise<RuntimeDiagnosticsSnapshot> {
    const now = Date.now();
    this.pruneRecentRequests(now);
    return {
      startedAt: this.startedAt.toISOString(),
      uptimeMs: now - this.startedAt.getTime(),
      memory: process.memoryUsage(),
      http: {
        totalRequests: this.totalRequests,
        recentRequestsPerMinute: this.recentRequestTimestamps.length,
        inFlightRequests: this.inFlightRequests,
        byRoute: [...this.routes.entries()]
          .map(([key, stats]) => ({
            key,
            method: stats.method,
            path: stats.path,
            count: stats.count,
            errorCount: stats.errorCount,
            averageDurationMs: stats.count ? Math.round(stats.totalDurationMs / stats.count) : 0,
            lastStatusCode: stats.lastStatusCode,
            lastDurationMs: stats.lastDurationMs,
            lastSeenAt: stats.lastSeenAt
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 30)
      },
      websocket: {
        activeConnections: this.activeWebSockets,
        totalConnections: this.totalWebSockets,
        messagesSent: this.messagesSent,
        helloEventsSent: this.helloEventsSent
      },
      events: this.events.stats(),
      persistence: await this.events.persistenceStats()
    };
  }

  private pruneRecentRequests(now: number): void {
    const cutoff = now - 60_000;
    while (this.recentRequestTimestamps.length && this.recentRequestTimestamps[0] < cutoff) {
      this.recentRequestTimestamps.shift();
    }
  }
}

function routePath(req: express.Request): string {
  return req.route?.path ? `${req.baseUrl}${String(req.route.path)}` : req.path;
}
