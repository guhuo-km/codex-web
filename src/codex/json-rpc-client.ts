import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { AppError } from "../errors.js";

export type JsonRpcId = string | number;

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcServerRequest {
  method: string;
  id: JsonRpcId;
  params?: unknown;
}

export interface CodexJsonRpcClientOptions {
  url: string;
  token?: string;
  experimentalApi?: boolean;
  clientName?: string;
  clientTitle?: string;
  clientVersion?: string;
  requestTimeoutMs?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class CodexJsonRpcClient {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly emitter = new EventEmitter();
  private readonly requestTimeoutMs: number;

  constructor(private readonly options: CodexJsonRpcClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.ws = await this.openSocket();
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("close", () => this.rejectAll(new AppError("Codex app-server connection closed", "CODEX_DISCONNECTED", 503)));
    this.ws.on("error", (error) => this.emitter.emit("error", error));

    await this.sendInitialize();
    await this.sendAndFlush({ method: "initialized" });
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++;
    this.send({ method, id, params });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError(`Codex request timed out: ${method}`, "CODEX_REQUEST_TIMEOUT", 504));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
    });
  }

  notify(method: string, params?: unknown): void {
    this.send(params === undefined ? { method } : { method, params });
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.send({ id, result });
  }

  reject(id: JsonRpcId, code: number, message: string): void {
    this.send({ id, error: { code, message } });
  }

  onNotification(listener: (notification: JsonRpcNotification) => void): () => void {
    this.emitter.on("notification", listener);
    return () => this.emitter.off("notification", listener);
  }

  onServerRequest(listener: (request: JsonRpcServerRequest) => void): () => void {
    this.emitter.on("serverRequest", listener);
    return () => this.emitter.off("serverRequest", listener);
  }

  close(): void {
    this.ws?.close();
    this.rejectAll(new AppError("Codex app-server connection closed", "CODEX_DISCONNECTED", 503));
  }

  private async openSocket(): Promise<WebSocket> {
    const headers = this.options.token ? { Authorization: `Bearer ${this.options.token}` } : undefined;
    const ws = new WebSocket(this.options.url, { headers });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    return ws;
  }

  private async sendInitialize(): Promise<void> {
    const id = "initialize";
    this.send({
      method: "initialize",
      id,
      params: {
        clientInfo: {
          name: this.options.clientName ?? "codex_web",
          title: this.options.clientTitle ?? "codex-web",
          version: this.options.clientVersion ?? "0.1.0"
        },
        capabilities: {
          experimentalApi: this.options.experimentalApi ?? true,
          requestAttestation: false
        }
      }
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError("Codex initialize timed out", "CODEX_INITIALIZE_TIMEOUT", 504));
      }, this.requestTimeoutMs);
      this.pending.set(id, {
        resolve: () => resolve(),
        reject,
        timer
      });
    });
  }

  private handleMessage(raw: string): void {
    const message = JSON.parse(raw) as any;

    if ("id" in message && ("result" in message || "error" in message) && !("method" in message)) {
      this.resolveResponse(message);
      return;
    }

    if ("id" in message && "method" in message) {
      this.emitter.emit("serverRequest", {
        id: message.id,
        method: message.method,
        params: message.params
      });
      return;
    }

    if ("method" in message) {
      this.emitter.emit("notification", {
        method: message.method,
        params: message.params
      });
    }
  }

  private resolveResponse(message: any): void {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);

    if ("error" in message) {
      const error = message.error || {};
      pending.reject(new AppError(error.message || "Codex request failed", "CODEX_JSON_RPC_ERROR", 502));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private send(message: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new AppError("Codex app-server is not connected", "CODEX_DISCONNECTED", 503);
    }
    this.ws.send(JSON.stringify(message));
  }

  private sendAndFlush(message: unknown): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new AppError("Codex app-server is not connected", "CODEX_DISCONNECTED", 503);
    }
    return new Promise((resolve, reject) => {
      this.ws?.send(JSON.stringify(message), (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}
