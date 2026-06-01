import type {
  ApiEnvelope,
  AuthSettings,
  AuthStatus,
  BridgeEvent,
  CapabilityPayload,
  FsDirectoryListing,
  FsRoot,
  NotificationDeliveryRecord,
  NotificationSettings,
  TitleGenerationSettings,
  ModelListResponse,
  PendingApproval,
  ProjectRecord,
  StatusPayload,
  TaskSummary,
  ThemeRecord,
  ThreadSummary,
  TrashPayload,
  UploadedFile,
  UploadedImage,
  UserPreferences,
  WorkspaceGroup
} from "./types";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("codex-auth-required"));
    }
    throw new Error(body?.error?.message ?? `Request failed: ${response.status}`);
  }
  return (body as ApiEnvelope<T>).data;
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  authSettings: () => request<AuthSettings>("/api/auth/settings"),
  updateAuthSettings: (input: Partial<AuthSettings>) => request<AuthSettings>("/api/auth/settings", { method: "PUT", body: JSON.stringify(input) }),
  login: (input: { password: string; remember?: boolean }) => request<{ authenticated: boolean }>("/api/auth/login", { method: "POST", body: JSON.stringify(input) }),
  logout: () => request<{ authenticated: boolean }>("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }),
  status: () => request<StatusPayload>("/api/status"),
  fsRoots: () => request<FsRoot[]>("/api/fs/roots"),
  fsList: (path?: string) => request<FsDirectoryListing>(`/api/fs/list${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  fsCreateDirectory: (parentPath: string, name: string) => request<FsDirectoryListing>("/api/fs/directories", { method: "POST", body: JSON.stringify({ parentPath, name }) }),
  fsRenameDirectory: (path: string, name: string) => request<FsDirectoryListing>("/api/fs/directories/rename", { method: "POST", body: JSON.stringify({ path, name }) }),
  fsDeleteDirectory: (path: string) => request<FsDirectoryListing>("/api/fs/directories/delete", { method: "POST", body: JSON.stringify({ path }) }),
  projects: () => request<ProjectRecord[]>("/api/projects"),
  trash: () => request<TrashPayload>("/api/trash"),
  addProject: (cwd: string) => request<ProjectRecord[]>("/api/projects", { method: "POST", body: JSON.stringify({ cwd }) }),
  renameProject: (cwd: string, name: string) => request<ProjectRecord[]>("/api/projects/rename", { method: "POST", body: JSON.stringify({ cwd, name }) }),
  pinProject: (cwd: string) => request<ProjectRecord[]>("/api/projects/pin", { method: "POST", body: JSON.stringify({ cwd }) }),
  moveProject: (cwd: string, direction: "up" | "down") => request<ProjectRecord[]>("/api/projects/move", { method: "POST", body: JSON.stringify({ cwd, direction }) }),
  deleteProject: (cwd: string) => request<ProjectRecord[]>("/api/projects/delete", { method: "POST", body: JSON.stringify({ cwd }) }),
  restoreProject: (cwd: string) => request<ProjectRecord[]>("/api/projects/restore", { method: "POST", body: JSON.stringify({ cwd }) }),
  quickCreateProject: () => request<{ project?: ProjectRecord; projects: ProjectRecord[] }>("/api/projects/quick-create", { method: "POST", body: JSON.stringify({}) }),
  themes: () => request<ThemeRecord[]>("/api/themes"),
  createTheme: (name: string, css: string) => request<ThemeRecord[]>("/api/themes", { method: "POST", body: JSON.stringify({ name, css }) }),
  deleteTheme: (id: string) => request<ThemeRecord[]>("/api/themes/delete", { method: "POST", body: JSON.stringify({ id }) }),
  preferences: () => request<UserPreferences>("/api/preferences"),
  updatePreferences: (input: Partial<UserPreferences>) => request<UserPreferences>("/api/preferences", { method: "PUT", body: JSON.stringify(input) }),
  notifications: () => request<NotificationSettings>("/api/notifications"),
  updateNotifications: (input: Partial<NotificationSettings>) => request<NotificationSettings>("/api/notifications", { method: "PUT", body: JSON.stringify(input) }),
  titleGeneration: () => request<TitleGenerationSettings>("/api/title-generation"),
  updateTitleGeneration: (input: { enabled?: boolean; apiBaseUrl?: string; apiKey?: string; model?: string; timeoutMs?: number }) => request<TitleGenerationSettings>("/api/title-generation", {
    method: "PUT",
    body: JSON.stringify(input)
  }),
  notificationDeliveries: (limit?: number) => request<NotificationDeliveryRecord[]>(`/api/notifications/deliveries${limit ? `?limit=${encodeURIComponent(String(limit))}` : ""}`),
  testNotifications: (input?: { title?: string; message?: string }) => request<NotificationDeliveryRecord[]>("/api/notifications/test", {
    method: "POST",
    body: JSON.stringify(input ?? {})
  }),
  workspaces: () => request<WorkspaceGroup[]>("/api/workspaces"),
  threads: (cwd?: string) => request<{ data?: ThreadSummary[] } | ThreadSummary[]>(`/api/threads${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`),
  pinThread: (cwd: string, threadId: string) => request<unknown>("/api/threads/pin", { method: "POST", body: JSON.stringify({ cwd, threadId }) }),
  moveThread: (cwd: string, threadId: string, targetThreadId: string, placement?: "before" | "after", orderedThreadIds?: string[]) => request<unknown>("/api/threads/move", { method: "POST", body: JSON.stringify({ cwd, threadId, targetThreadId, placement, orderedThreadIds }) }),
  deleteThread: (cwd: string, threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}`, { method: "DELETE", body: JSON.stringify({ cwd }) }),
  restoreThread: (cwd: string, threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/restore`, { method: "POST", body: JSON.stringify({ cwd }) }),
  thread: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}`),
  resumeThread: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/resume`, { method: "POST", body: JSON.stringify({}) }),
  tasks: (threadId?: string) => request<TaskSummary[]>(`/api/tasks${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`),
  events: (threadId?: string) => request<BridgeEvent[]>(`/api/events${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ""}`),
  approvals: () => request<PendingApproval[]>("/api/approvals"),
  models: () => request<ModelListResponse>("/api/models?limit=100"),
  capabilities: () => request<CapabilityPayload>("/api/capabilities"),
  setSkillEnabled: (input: { name?: string; path?: string; enabled: boolean }) => request<unknown>("/api/skills/config", { method: "POST", body: JSON.stringify(input) }),
  setPluginEnabled: (pluginId: string, enabled: boolean) => request<unknown>("/api/plugins/config", { method: "POST", body: JSON.stringify({ pluginId, enabled }) }),
  uploadImage: (input: { name: string; mimeType: string; dataUrl: string }) => request<UploadedImage>("/api/uploads/images", { method: "POST", body: JSON.stringify(input) }),
  uploadFile: (input: { name: string; mimeType: string; dataUrl: string }) => request<UploadedFile>("/api/uploads/files", { method: "POST", body: JSON.stringify(input) }),
  startThread: (input: { cwd?: string }) => request<{ thread?: { id?: string } }>("/api/threads", { method: "POST", body: JSON.stringify(input) }),
  startTurn: (threadId: string, text: string, overrides?: Record<string, unknown>, input?: Array<Record<string, unknown>>) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/turns`, {
    method: "POST",
    body: JSON.stringify(input?.length ? { input, overrides } : { text, overrides })
  }),
  interrupt: (threadId: string, turnId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/interrupt`, { method: "POST", body: JSON.stringify({ turnId }) }),
  steer: (threadId: string, text: string, turnId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/steer`, { method: "POST", body: JSON.stringify({ text, turnId }) }),
  rollback: (threadId: string, numTurns: number) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/rollback`, { method: "POST", body: JSON.stringify({ numTurns }) }),
  rollbackToTurn: (threadId: string, turnId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/rollback-to-turn`, { method: "POST", body: JSON.stringify({ turnId }) }),
  compactThread: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/compact`, { method: "POST", body: JSON.stringify({}) }),
  forkThread: (threadId: string, overrides?: Record<string, unknown>) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/fork`, {
    method: "POST",
    body: JSON.stringify({ overrides })
  }),
  setThreadGoal: (threadId: string, input: { objective?: string; status?: string; tokenBudget?: number | null }) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`, {
    method: "POST",
    body: JSON.stringify(input)
  }),
  getThreadGoal: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`),
  clearThreadGoal: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/goal`, { method: "DELETE" }),
  setThreadName: (threadId: string, name: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/name`, {
    method: "POST",
    body: JSON.stringify({ name })
  }),
  generateThreadTitle: (threadId: string) => request<unknown>(`/api/threads/${encodeURIComponent(threadId)}/title/generate`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  approve: (requestId: string | number, result: unknown = { decision: "accept" }) => request<unknown>(`/api/approvals/${encodeURIComponent(String(requestId))}/approve`, { method: "POST", body: JSON.stringify(result) }),
  reject: (requestId: string | number, message: string) => request<unknown>(`/api/approvals/${encodeURIComponent(String(requestId))}/reject`, { method: "POST", body: JSON.stringify({ message }) })
};

export function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}
