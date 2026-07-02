export interface ApiEnvelope<T> {
  ok: boolean;
  data: T;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

export interface AuthSettings {
  enabled: boolean;
  password: string;
}

export interface ThreadSummary {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
  deletedAt?: number;
  pinned?: boolean;
  order?: number;
  status?: string;
  parentThreadId?: string;
  threadSource?: string;
  agentNickname?: string;
  agentRole?: string;
  isSubagent?: boolean;
}

export interface UiThread {
  id: string;
  cwd: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
  order?: number;
  status?: UiThreadStatus;
  parentThreadId?: string;
  threadSource?: string;
  agentNickname?: string;
  agentRole?: string;
  isSubagent?: boolean;
  lastError?: string;
  isDraft: boolean;
  needsResume?: boolean;
  isLoadingHistory?: boolean;
  messages: UiMessage[];
}

export type UiThreadStatus = "completed" | "running" | "failed";
export type UiThreadActivityIndicator = "running" | "completed" | "failed";

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt?: number;
  turnId?: string;
  images?: UploadedImage[];
  isStreaming?: boolean;
  turnStartedAt?: number;
  turnCompletedAt?: number;
  turnDurationMs?: number;
  tokenUsage?: UiTokenUsage;
  assistantParts?: UiAssistantPart[];
  attachments?: UploadedAttachment[];
  systemMarker?: "contextCompaction";
  synthetic?: "manualCompact";
  statusText?: string;
  statusTone?: "danger" | "muted";
  steerMessages?: QueuedSteerMessage[];
}

export interface UiTokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type UiAssistantPart =
  | { type: "text"; id: string; text: string }
  | { type: "tool"; id: string; toolCall: UiToolCall }
  | { type: "subagent"; id: string; subagent: UiSubagentCall }
  | { type: "reasoning"; id: string; text: string; summary?: boolean }
  | { type: "agentEvent"; id: string; event: UiAgentEvent }
  | { type: "steer"; id: string; text: string; status: SteerMessageStatus };

export type UiAgentEventKind = "status" | "warning" | "error";
export type UiAgentEventTone = "muted" | "info" | "warning" | "danger";

export interface UiAgentEvent {
  kind: UiAgentEventKind;
  title: string;
  message?: string;
  tone: UiAgentEventTone;
  details?: unknown;
  createdAt?: number;
  eventType?: string;
}

export interface UiToolCall {
  id: string;
  type: string;
  command: string;
  title?: string;
  toolName?: string;
  server?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  changes?: UiFileChange[];
  cwd?: string;
  status?: "inProgress" | "completed" | "failed" | "cancelled" | string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  commandExplanation?: string;
}

export interface UiSubagentCall {
  id: string;
  type: "collabAgentToolCall" | "subAgentActivity";
  tool?: string;
  agentPath?: string;
  agentThreadId?: string;
  receiverThreadIds?: string[];
  senderThreadId?: string;
  prompt?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  status?: string;
  agentsStates?: Record<string, { status?: string; message?: string | null }>;
  kind?: string;
  details?: unknown;
}

export interface UiFileChange {
  path: string;
  kind?: string;
  movePath?: string | null;
  diff?: string;
}

export interface UiWorkspace {
  cwd: string;
  name: string;
  updatedAt: number;
  pinned?: boolean;
  runningCount: number;
  threads: UiThread[];
}

export interface ProjectRecord {
  cwd: string;
  name: string;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  deletedAt?: number;
}

export interface TrashPayload {
  projects: ProjectRecord[];
  threads: ThreadSummary[];
}

export interface ThemeRecord {
  id: string;
  name: string;
  source: "builtin" | "custom";
  css: string;
}

export interface UploadedImage {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  input: {
    type: "localImage";
    path: string;
    detail: "high" | "low" | "auto";
  };
}

export interface UploadedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export type UploadedAttachment =
  | ({ kind: "image" } & UploadedImage)
  | ({ kind: "file" } & UploadedFile);

export interface ModelRecord {
  id: string;
  name?: string;
}

export interface ModelListResponse {
  data: ModelRecord[];
  nextCursor: string | null;
}

export type WorkMode = "default" | "auto-review" | "full-access" | "yolo";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type ComposerCommandMode = "plan";
export type SendBehavior = "enter" | "shiftEnter";
export type ToolGroupCollapseMode = "alwaysCollapsed" | "alwaysExpanded" | "collapseAfterComplete";
export type ThreadGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

export interface QueuedSteerMessage {
  id: string;
  text: string;
  status: SteerMessageStatus;
}

export type SteerMessageStatus = "queued" | "submitted" | "sent" | "failed";

export interface PendingCompactMessage {
  id: string;
  text: string;
  attachments: UploadedAttachment[];
}

export interface LocalUserDefaults {
  model?: string;
  workMode: WorkMode;
  reasoningEffort: ReasoningEffort;
}

export interface UserPreferences {
  colorMode: "light" | "dark";
  activeThemeId: string;
  collapseToolGroupsByDefault: boolean;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  approvalDetailsCollapsedByDefault: boolean;
  renderUserMessagesAsMarkdown: boolean;
  historyCacheTurnLimit: number;
  sidebarWidth: number;
  sidebarCollapsed?: boolean;
  sendBehavior: SendBehavior;
  desktopSendBehavior: SendBehavior;
  mobileSendBehavior: SendBehavior;
  defaultModel?: string;
  defaultWorkMode: WorkMode;
  defaultEffort: ReasoningEffort;
}

export type NotificationChannelType = "pushplus" | "telegram" | "serverchan" | "feishu" | "qmsg";

export interface NotificationBuiltInChannel {
  id: string;
  type: NotificationChannelType;
  enabled: boolean;
  token?: string;
  botToken?: string;
  chatId?: string;
  sendKey?: string;
  webhookUrl?: string;
  qmsgKey?: string;
}

export interface NotificationCustomChannel {
  id: string;
  type: "custom";
  name: string;
  enabled: boolean;
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyTemplate: string;
  bodyFormat: "text" | "json";
  timeoutMs: number;
}

export interface NotificationSettings {
  channels: NotificationBuiltInChannel[];
  customChannels: NotificationCustomChannel[];
}

export interface NotificationDeliveryRecord {
  id: string;
  channelId: string;
  channelType: NotificationChannelType | "custom";
  ok: boolean;
  status?: number;
  responseBody?: string;
  error?: string;
  notificationTitle: string;
  threadId?: string;
  turnId?: string;
  createdAt: string;
}

export interface TitleGenerationSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  model: string;
  timeoutMs: number;
}

export interface WorkspaceGroup {
  cwd: string;
  name: string;
  updatedAt: number;
  runningCount: number;
  threads: ThreadSummary[];
}

export interface FsRoot {
  name: string;
  path: string;
}

export interface FsEntry {
  name: string;
  path: string;
  type: "directory";
}

export interface FsDirectoryListing {
  path: string;
  name: string;
  parentPath?: string;
  roots: FsRoot[];
  entries: FsEntry[];
}

export interface BridgeEvent {
  seq: number;
  type: string;
  createdAt: string;
  threadId?: string;
  turnId?: string;
  payload: unknown;
}

export interface TaskSummary {
  threadId: string;
  turnId: string;
  status: "running" | "completed" | "failed" | "interrupted";
  kind?: "normal" | "compact";
  startedAt: string;
  completedAt?: string;
  lastEventAt: string;
  lastSeq: number;
  eventCount: number;
}

export interface PendingApproval {
  id: string | number;
  method: string;
  params?: unknown;
}

export interface StatusPayload {
  connected: boolean;
  codexAppServerUrl?: string;
  runningTurns?: TaskSummary[];
}

export interface CapabilityPayload {
  skills?: {
    data?: Array<{
      cwd: string;
      skills: SkillCapability[];
      errors?: unknown[];
    }>;
  };
  plugins?: {
    marketplaces?: Array<{
      name: string;
      plugins: PluginCapability[];
    }>;
  };
  mcpServers?: {
    data?: McpServerCapability[];
  };
}

export interface SkillCapability {
  name: string;
  description?: string;
  path: string;
  scope?: string;
  enabled: boolean;
}

export interface PluginCapability {
  id: string;
  name: string;
  installed: boolean;
  enabled: boolean;
  availability?: string;
  installPolicy?: string;
}

export interface McpServerCapability {
  name: string;
  authStatus: "unsupported" | "notLoggedIn" | "bearerToken" | "oAuth" | string;
  tools?: Record<string, unknown>;
  resources?: unknown[];
  resourceTemplates?: unknown[];
}

export interface HelloMessage {
  type: "hello";
  events: BridgeEvent[];
  tasks: TaskSummary[];
  pendingServerRequests: PendingApproval[];
}

export interface EventMessage {
  type: "event";
  event: BridgeEvent;
}

export type WsMessage = HelloMessage | EventMessage;
