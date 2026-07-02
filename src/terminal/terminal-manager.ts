import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import os from "node:os";
import { basename } from "node:path";
import type WebSocket from "ws";
import * as pty from "node-pty";
import type { IPty } from "node-pty";

export interface TerminalSessionSummary {
  id: string;
  cwd: string;
  name: string;
  shell: string;
  createdAt: number;
  updatedAt: number;
  status: "running" | "exited";
  exitCode?: number;
}

interface TerminalSession extends TerminalSessionSummary {
  pty?: IPty;
  output: string;
  pendingOutput: string;
  outputFlushTimer?: NodeJS.Timeout;
  subscribers: Set<WebSocket>;
}

interface TerminalClientMessage {
  type?: string;
  sessionId?: string;
  cwd?: string;
  input?: string;
  cols?: number;
  rows?: number;
}

const MAX_REPLAY_CHARS = 200_000;

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  handleMessage(ws: WebSocket, message: TerminalClientMessage): boolean {
    switch (message.type) {
      case "terminal.list":
        this.send(ws, { type: "terminal.sessions", sessions: this.list() });
        return true;
      case "terminal.create":
        this.create(ws, message);
        return true;
      case "terminal.attach":
        this.attach(ws, String(message.sessionId ?? ""));
        return true;
      case "terminal.input":
        this.write(ws, message);
        return true;
      case "terminal.resize":
        this.resize(ws, message);
        return true;
      case "terminal.close":
        this.close(ws, String(message.sessionId ?? ""));
        return true;
      default:
        return false;
    }
  }

  handleClose(ws: WebSocket): void {
    for (const session of this.sessions.values()) {
      session.subscribers.delete(ws);
    }
  }

  list(): TerminalSessionSummary[] {
    return Array.from(this.sessions.values()).map((session) => this.summary(session));
  }

  private create(ws: WebSocket, message: TerminalClientMessage): void {
    const cwd = typeof message.cwd === "string" && message.cwd.trim() ? message.cwd : process.cwd();
    if (!isDirectory(cwd)) {
      this.send(ws, { type: "terminal.error", message: `Terminal cwd does not exist: ${cwd}` });
      return;
    }

    const shell = defaultShell();
    const cols = normalizeDimension(message.cols, 80);
    const rows = normalizeDimension(message.rows, 24);
    const id = randomUUID();
    const now = Date.now();
    const session: TerminalSession = {
      id,
      cwd,
      name: terminalName(cwd, this.sessions.size + 1),
      shell,
      createdAt: now,
      updatedAt: now,
      status: "running",
      output: "",
      pendingOutput: "",
      subscribers: new Set([ws])
    };

    try {
      session.pty = pty.spawn(shell, defaultShellArgs(shell), {
        name: "xterm-256color",
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: "xterm-256color" }
      });
    } catch (error) {
      this.send(ws, { type: "terminal.error", message: error instanceof Error ? error.message : String(error) });
      return;
    }

    session.pty.onData((data) => {
      session.output = trimReplay(`${session.output}${data}`);
      session.updatedAt = Date.now();
      this.queueOutput(session, data);
    });
    session.pty.onExit(({ exitCode }) => {
      this.flushOutput(session);
      session.status = "exited";
      session.exitCode = exitCode;
      session.updatedAt = Date.now();
      session.pty = undefined;
      this.broadcast(session, { type: "terminal.exit", sessionId: id, exitCode });
    });

    this.sessions.set(id, session);
    this.send(ws, { type: "terminal.created", session: this.summary(session), sessions: this.list() });
    this.send(ws, { type: "terminal.snapshot", sessionId: id, output: session.output });
  }

  private attach(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.send(ws, { type: "terminal.error", message: "Terminal session not found", sessionId });
      return;
    }
    session.subscribers.add(ws);
    this.send(ws, { type: "terminal.attached", session: this.summary(session), sessions: this.list() });
    this.send(ws, { type: "terminal.snapshot", sessionId, output: session.output });
  }

  private write(ws: WebSocket, message: TerminalClientMessage): void {
    const session = this.sessions.get(String(message.sessionId ?? ""));
    if (!session?.pty || session.status !== "running") return;
    if (typeof message.input !== "string") return;
    session.pty.write(message.input);
  }

  private resize(ws: WebSocket, message: TerminalClientMessage): void {
    const session = this.sessions.get(String(message.sessionId ?? ""));
    if (!session?.pty || session.status !== "running") return;
    session.pty.resize(normalizeDimension(message.cols, 80), normalizeDimension(message.rows, 24));
  }

  private close(ws: WebSocket, sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.flushOutput(session);
    if (session.outputFlushTimer) clearTimeout(session.outputFlushTimer);
    session.pty?.kill();
    this.sessions.delete(sessionId);
    this.send(ws, { type: "terminal.closed", sessionId, sessions: this.list() });
    this.broadcast(session, { type: "terminal.closed", sessionId, sessions: this.list() });
  }

  private summary(session: TerminalSession): TerminalSessionSummary {
    const { pty: _pty, output: _output, pendingOutput: _pendingOutput, outputFlushTimer: _outputFlushTimer, subscribers: _subscribers, ...summary } = session;
    return summary;
  }

  private queueOutput(session: TerminalSession, data: string): void {
    session.pendingOutput += data;
    if (session.outputFlushTimer) return;
    session.outputFlushTimer = setTimeout(() => {
      session.outputFlushTimer = undefined;
      this.flushOutput(session);
    }, 16);
  }

  private flushOutput(session: TerminalSession): void {
    if (!session.pendingOutput) return;
    const data = session.pendingOutput;
    session.pendingOutput = "";
    this.broadcast(session, { type: "terminal.output", sessionId: session.id, data });
  }

  private broadcast(session: TerminalSession, payload: unknown): void {
    const serialized = JSON.stringify(payload);
    for (const subscriber of session.subscribers) {
      if (subscriber.readyState === subscriber.OPEN) subscriber.send(serialized);
    }
  }

  private send(ws: WebSocket, payload: unknown): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }
}

function defaultShell(): string {
  if (process.platform === "win32") return process.env.ComSpec?.toLowerCase().includes("powershell") ? process.env.ComSpec : "powershell.exe";
  return process.env.SHELL || "bash";
}

function defaultShellArgs(shell: string): string[] {
  if (process.platform !== "win32") return [];
  return shell.toLowerCase().endsWith("powershell.exe") ? ["-NoLogo"] : [];
}

function terminalName(cwd: string, index: number): string {
  return `${basename(cwd) || os.hostname()} ${index}`;
}

function normalizeDimension(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(2, Math.min(500, Math.floor(value)));
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function trimReplay(output: string): string {
  if (output.length <= MAX_REPLAY_CHARS) return output;
  return output.slice(output.length - MAX_REPLAY_CHARS);
}
