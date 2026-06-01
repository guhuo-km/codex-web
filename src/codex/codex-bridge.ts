import type { CodexJsonRpcClient, JsonRpcNotification, JsonRpcServerRequest } from "./json-rpc-client.js";
import type { EventStore } from "../events/event-store.js";

export interface ListThreadsInput {
  cwd?: string;
  limit?: number;
  searchTerm?: string;
}

export interface StartThreadInput {
  cwd?: string;
  model?: string;
  modelProvider?: string;
  approvalPolicy?: unknown;
  sandbox?: unknown;
}

export type UserInputItem = Record<string, unknown>;

export class CodexBridge {
  private readonly serverRequests = new Map<string, JsonRpcServerRequest>();

  constructor(
    private readonly client: Pick<
      CodexJsonRpcClient,
      "request" | "respond" | "reject" | "onNotification" | "onServerRequest"
    >,
    private readonly events: EventStore
  ) {
    this.client.onNotification((notification) => this.handleNotification(notification));
    this.client.onServerRequest((request) => this.handleServerRequest(request));
  }

  listThreads(input: ListThreadsInput = {}): Promise<unknown> {
    return this.client.request("thread/list", {
      cwd: input.cwd,
      limit: input.limit ?? 50,
      sortDirection: "desc",
      searchTerm: input.searchTerm
    });
  }

  startThread(input: StartThreadInput = {}): Promise<unknown> {
    return this.client.request("thread/start", compactObject({ ...input }));
  }

  resumeThread(threadId: string): Promise<unknown> {
    return this.client.request("thread/resume", { threadId });
  }

  readThread(threadId: string, includeTurns = true): Promise<unknown> {
    return this.client.request("thread/read", { threadId, includeTurns });
  }

  rollbackThread(threadId: string, numTurns: number): Promise<unknown> {
    return this.client.request("thread/rollback", { threadId, numTurns });
  }

  compactThread(threadId: string): Promise<unknown> {
    this.events.markNextTurnCompact(threadId);
    return this.client.request("thread/compact/start", { threadId });
  }

  forkThread(threadId: string, overrides: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.request("thread/fork", compactObject({ threadId, ...overrides }));
  }

  archiveThread(threadId: string): Promise<unknown> {
    return this.client.request("thread/archive", { threadId });
  }

  setThreadGoal(threadId: string, input: { objective?: string; status?: string; tokenBudget?: number | null }): Promise<unknown> {
    return this.client.request("thread/goal/set", compactObject({
      threadId,
      objective: input.objective,
      status: input.status,
      tokenBudget: input.tokenBudget
    }));
  }

  getThreadGoal(threadId: string): Promise<unknown> {
    return this.client.request("thread/goal/get", { threadId });
  }

  clearThreadGoal(threadId: string): Promise<unknown> {
    return this.client.request("thread/goal/clear", { threadId });
  }

  setThreadName(threadId: string, name: string): Promise<unknown> {
    return this.client.request("thread/name/set", { threadId, name });
  }

  getConversationSummary(threadId: string): Promise<unknown> {
    return this.client.request("getConversationSummary", { conversationId: threadId });
  }

  startTurn(threadId: string, text: string, overrides: Record<string, unknown> = {}): Promise<unknown> {
    return this.startTurnItems(threadId, textInput(text), overrides);
  }

  startTurnItems(threadId: string, input: UserInputItem[], overrides: Record<string, unknown> = {}): Promise<unknown> {
    return this.client.request("turn/start", {
      threadId,
      input,
      ...compactObject(overrides)
    });
  }

  interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.client.request("turn/interrupt", { threadId, turnId });
  }

  steerTurn(threadId: string, text: string, expectedTurnId: string): Promise<unknown> {
    return this.client.request("turn/steer", { threadId, input: textInput(text), expectedTurnId });
  }

  listSkills(cwds: string[], forceReload = false): Promise<unknown> {
    return this.client.request("skills/list", { cwds, forceReload });
  }

  listPlugins(): Promise<unknown> {
    return this.client.request("plugin/list", {});
  }

  listMcpServers(): Promise<unknown> {
    return this.client.request("mcpServerStatus/list", {});
  }

  listModels(input: { cursor?: string; limit?: number; includeHidden?: boolean } = {}): Promise<unknown> {
    return this.client.request("model/list", compactObject(input));
  }

  readConfig(): Promise<unknown> {
    return this.client.request("config/read", {});
  }

  writeSkillConfig(input: { name?: string; path?: string; enabled: boolean }): Promise<unknown> {
    return this.client.request("skills/config/write", compactObject(input));
  }

  writeConfigBatch(input: { edits: Array<{ keyPath: string; value: unknown; mergeStrategy: "replace" | "upsert" }>; reloadUserConfig?: boolean }): Promise<unknown> {
    return this.client.request("config/batchWrite", compactObject(input));
  }

  approveServerRequest(requestId: string | number, result: unknown): void {
    const normalizedResult = normalizeApprovalResult(result);
    const responseId = this.resolveServerRequestId(requestId);
    this.client.respond(responseId, normalizedResult);
    this.appendServerRequestResolved(requestId, normalizedResult);
    this.serverRequests.delete(String(requestId));
  }

  rejectServerRequest(requestId: string | number, message: string): void {
    const normalizedResult = { decision: "decline" };
    const responseId = this.resolveServerRequestId(requestId);
    this.client.respond(responseId, normalizedResult);
    this.appendServerRequestResolved(requestId, normalizedResult, message);
    this.serverRequests.delete(String(requestId));
  }

  getPendingServerRequests(): JsonRpcServerRequest[] {
    return [...this.serverRequests.values()];
  }

  private handleNotification(notification: JsonRpcNotification): void {
    const params = (notification.params ?? {}) as any;
    const threadId = params.threadId ?? params.thread?.id;
    const turnId = params.turnId ?? params.turn?.id;

    this.events.append({
      type: `codex.${notification.method}`,
      threadId,
      turnId,
      payload: notification
    });

    if (notification.method === "turn/started" && threadId && turnId) {
      this.events.recordTurnStart(threadId, turnId);
    }

    if (notification.method === "turn/completed" && threadId && turnId) {
      const status = normalizeTurnStatus(params.turn?.status);
      this.events.recordTurnComplete(threadId, turnId, status, {
        message: readTurnErrorMessage(params),
        error: readTurnError(params)
      });
    }
  }

  private handleServerRequest(request: JsonRpcServerRequest): void {
    this.serverRequests.set(String(request.id), request);
    this.events.append({
      type: `codex.request.${request.method}`,
      payload: request
    });
  }

  private appendServerRequestResolved(requestId: string | number, result: Record<string, unknown>, message?: string): void {
    const request = this.serverRequests.get(String(requestId));
    this.events.append({
      type: "codex.serverRequest/resolved",
      threadId: readPath<string>(request, ["params", "threadId"]),
      turnId: readPath<string>(request, ["params", "turnId"]),
      payload: {
        requestId: request?.id ?? requestId,
        method: request?.method,
        decision: result.decision,
        result,
        message
      }
    });
  }

  private resolveServerRequestId(requestId: string | number): string | number {
    return this.serverRequests.get(String(requestId))?.id ?? requestId;
  }
}

function textInput(text: string): Array<{ type: "text"; text: string; text_elements: [] }> {
  return [{ type: "text", text, text_elements: [] }];
}

function normalizeTurnStatus(status: unknown): "completed" | "failed" | "interrupted" {
  if (status === "failed") return "failed";
  if (status === "interrupted") return "interrupted";
  return "completed";
}

function normalizeApprovalResult(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { decision: "accept" };
  }
  const record = result as Record<string, unknown>;
  const decision = record.decision;
  if (decision === "accept" || decision === "decline") {
    return decision === "accept"
      ? { ...record, decision: "accept" }
      : { decision: "decline" };
  }
  if (decision === "alwaysAllow") {
    return {
      ...record,
      decision: "accept",
      acceptSettings: {
        ...(typeof record.acceptSettings === "object" && record.acceptSettings && !Array.isArray(record.acceptSettings) ? record.acceptSettings as Record<string, unknown> : {}),
        forSession: true
      }
    };
  }
  return {
    ...record,
    decision: "accept"
  };
}

function readTurnError(params: any): Record<string, unknown> | undefined {
  const error = params?.turn?.error ?? params?.error;
  return error && typeof error === "object" && !Array.isArray(error) ? error : undefined;
}

function readTurnErrorMessage(params: any): string | undefined {
  return readPath<string>(params, ["turn", "error", "message"])
    ?? readPath<string>(params, ["turn", "error", "detail"])
    ?? readPath<string>(params, ["error", "message"])
    ?? readPath<string>(params, ["error", "detail"])
    ?? readPath<string>(params, ["message"]);
}

function readPath<T>(input: unknown, path: string[]): T | undefined {
  let current: any = input;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current as T | undefined;
}

function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}
