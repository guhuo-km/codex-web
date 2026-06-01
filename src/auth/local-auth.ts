import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Request, RequestHandler, Response, Router } from "express";
import express from "express";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

interface AuthRequestLike {
  headers: {
    cookie?: string | string[];
  };
}

const COOKIE_NAME = "codex_web_session";
const AUTH_ENV_FILE = ".evn";
const AUTH_ENV_KEYS = ["CODEX_WEB_AUTH_ENABLED", "CODEX_WEB_PASSWORD"] as const;

export class LocalAuth {
  private readonly sessions = new Map<string, { expiresAt?: number }>();
  private enabled: boolean;

  constructor(private readonly config: AppConfig) {
    this.enabled = config.authEnabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  router(): Router {
    const router = express.Router();
    router.get("/api/auth/status", (_req, res) => {
      res.json({ ok: true, data: { enabled: this.enabled, authenticated: this.isAuthenticated(_req) } });
    });
    router.get("/api/auth/settings", (req, res, next) => {
      void this.handleGetSettings(req, res).catch(next);
    });
    router.put("/api/auth/settings", express.json({ limit: "100kb" }), (req, res, next) => {
      void this.handleUpdateSettings(req, res).catch(next);
    });
    router.post("/api/auth/login", express.json({ limit: "100kb" }), (req, res) => {
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const remember = Boolean(req.body?.remember);
      if (!this.verifyPassword(password)) {
        throw new AppError("Invalid password", "UNAUTHORIZED", 401);
      }
      const token = this.createSession(remember);
      res.cookie(COOKIE_NAME, token, this.cookieOptions(remember));
      res.json({ ok: true, data: { authenticated: true } });
    });
    router.post("/api/auth/logout", (req, res) => {
      const token = this.readSessionToken(req);
      if (token) this.sessions.delete(token);
      res.clearCookie(COOKIE_NAME, this.cookieOptions(false));
      res.json({ ok: true, data: { authenticated: false } });
    });
    return router;
  }

  middleware(): RequestHandler {
    return (req, res, next) => {
      if (!this.enabled) return next();
      if (!req.path.startsWith("/api/")) return next();
      if (req.path.startsWith("/api/auth")) return next();
      if (req.path === "/health" || req.path === "/ready") return next();
      if (this.isAuthenticated(req)) return next();
      res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Login required" } });
    };
  }

  isAuthenticated(req: Request | AuthRequestLike): boolean {
    if (!this.enabled) return true;
    const token = this.readSessionToken(req);
    if (!token) return false;
    const session = this.sessions.get(token);
    if (!session) return false;
    if (session.expiresAt && session.expiresAt < Date.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  private createSession(remember: boolean): string {
    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, remember ? { expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 } : {});
    return token;
  }

  private verifyPassword(password: string): boolean {
    const expected = Buffer.from(this.config.password, "utf8");
    const actual = Buffer.from(password, "utf8");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  private readSessionToken(req: Request | AuthRequestLike): string | undefined {
    const cookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(";") : req.headers.cookie;
    if (!cookieHeader) return undefined;
    for (const pair of cookieHeader.split(";")) {
      const [name, ...rest] = pair.trim().split("=");
      if (name === COOKIE_NAME) return rest.join("=");
    }
    return undefined;
  }

  private cookieOptions(remember: boolean) {
    return {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: false,
      path: "/",
      ...(remember ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {})
    };
  }

  private async handleGetSettings(req: Request, res: Response): Promise<void> {
    this.requireAuthenticatedSettingsAccess(req);
    res.json({
      ok: true,
      data: {
        enabled: this.enabled,
        password: this.config.password
      }
    });
  }

  private async handleUpdateSettings(req: Request, res: Response): Promise<void> {
    this.requireAuthenticatedSettingsAccess(req);
    const body = typeof req.body === "object" && req.body ? req.body as Record<string, unknown> : {};
    const nextEnabled = typeof body.enabled === "boolean" ? body.enabled : this.enabled;
    let nextPassword: string | undefined;
    if (typeof body.password === "string") {
      nextPassword = body.password.trim();
      if (nextPassword.length === 0) {
        throw new AppError("Password cannot be empty", "VALIDATION_ERROR", 400);
      }
    }
    if (typeof body.enabled !== "boolean" && nextPassword === undefined) {
      throw new AppError("No auth settings provided", "VALIDATION_ERROR", 400);
    }
    const previousEnabled = this.enabled;
    const previousPassword = this.config.password;
    if (nextPassword !== undefined) {
      this.config.password = nextPassword;
    }
    this.enabled = nextEnabled;
    try {
      await this.persistSettings();
    } catch (error) {
      this.enabled = previousEnabled;
      this.config.password = previousPassword;
      throw error;
    }
    res.json({
      ok: true,
      data: {
        enabled: this.enabled,
        password: this.config.password
      }
    });
  }

  private requireAuthenticatedSettingsAccess(req: Request): void {
    if (!this.enabled || this.isAuthenticated(req)) return;
    throw new AppError("Login required", "UNAUTHORIZED", 401);
  }

  private async persistSettings(): Promise<void> {
    const filePath = join(this.config.configDir, AUTH_ENV_FILE);
    await mkdir(this.config.configDir, { recursive: true });
    const existing = await this.readEnvFile(filePath);
    const next = upsertEnvValues(existing, {
      CODEX_WEB_AUTH_ENABLED: this.enabled ? "true" : "false",
      CODEX_WEB_PASSWORD: this.config.password
    });
    await writeFile(filePath, `${next}\n`, "utf8");
  }

  private async readEnvFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }
}

function upsertEnvValues(source: string | null, values: Record<string, string>): string {
  const lines = source ? source.split(/\r?\n/) : [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      output.push(line);
      continue;
    }
    const key = trimmed.slice(0, trimmed.indexOf("=")).trim();
    if (AUTH_ENV_KEYS.includes(key as (typeof AUTH_ENV_KEYS)[number])) {
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(`${key}=${escapeEnvValue(values[key] ?? "")}`);
      continue;
    }
    output.push(line);
  }
  for (const key of AUTH_ENV_KEYS) {
    if (seen.has(key)) continue;
    output.push(`${key}=${escapeEnvValue(values[key] ?? "")}`);
  }
  return output.join("\n").trimEnd();
}

function escapeEnvValue(value: string): string {
  if (/^[A-Za-z0-9._\-/:@]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: string }).code === "ENOENT";
}
