import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { api, isAuthRequiredError, wsUrl } from "./api";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { ApprovalStack } from "./components/ApprovalStack";
import { LoginScreen } from "./components/LoginScreen";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { durationFromTiming, formatJsonValue, isCodexToolItem, isContextCompactionItem, normalizeContextCompactionMarker, normalizeRawResponseToolCall, normalizeRawResponseToolOutput, normalizeTokenUsage, normalizeToolCallFromItem, normalizeTurnStartedAt, normalizeTurnTiming, readPath } from "./codex-normalizers";
import { createClientId } from "./id";
import { appendOptimisticTurnMessages, mergeLoadedMessagesWithCurrent, upsertContextCompactionMarkerMessage } from "./message-ordering";
import { eventsToMessages, threadReadToMessages } from "./thread-history";
import type { AuthStatus, CapabilityPayload, ComposerCommandMode, PendingApproval, PendingCompactMessage, QueuedSteerMessage, ReasoningEffort, SendBehavior, StatusPayload, TaskSummary, ThemeRecord, ThreadSummary, ToolGroupCollapseMode, UiAssistantPart, UiMessage, UiThread, UiThreadActivityIndicator, UiToolCall, UiWorkspace, UploadedAttachment, UserPreferences, WorkMode } from "./types";

const DEFAULT_HISTORY_CACHE_TURNS = 30;
const MIN_HISTORY_CACHE_TURNS = 20;
const MAX_HISTORY_CACHE_TURNS = 200;
const SAVED_PASSWORD_KEY = "codex-web.savedPassword";
const ACTIVE_SELECTION_KEY = "codex-web.activeSelection";
const PENDING_THREAD_SHELL_TTL_MS = 30_000;

interface BridgeEventLike {
  type: string;
  seq?: number;
  createdAt?: string;
  threadId?: string;
  turnId?: string;
  payload?: unknown;
}

interface BridgeEventOptions {
  replay?: boolean;
}

interface PendingThreadShell {
  id: string;
  cwd: string;
  title: string;
  updatedAt: number;
  createdAt: number;
}

export function App() {
  const [workspaces, setWorkspaces] = useState<UiWorkspace[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(() => readStoredActiveSelection().threadId ?? null);
  const [activeCwd, setActiveCwd] = useState<string | undefined>(() => readStoredActiveSelection().cwd);
  const [colorMode, setColorMode] = useState<"light" | "dark">("light");
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [activeThemeId, setActiveThemeId] = useState("default");
  const [workMode, setWorkMode] = useState<WorkMode>("yolo");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ReasoningEffort>("medium");
  const [composerText, setComposerText] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<UploadedAttachment[]>([]);
  const [commandMode, setCommandMode] = useState<ComposerCommandMode | null>(null);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilityPayload | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [queuedSteers, setQueuedSteers] = useState<Record<string, QueuedSteerMessage[]>>({});
  const [pendingCompactMessages, setPendingCompactMessages] = useState<Record<string, PendingCompactMessage[]>>({});
  const pendingCompactMessagesRef = useRef<Record<string, PendingCompactMessage[]>>({});
  const [pendingCompactTurns, setPendingCompactTurns] = useState<Record<string, { userMessageId: string; assistantMessageId: string; startedAt: number }>>({});
  const pendingCompactTurnsRef = useRef<Record<string, { userMessageId: string; assistantMessageId: string; startedAt: number }>>({});
  const [threadActivityIndicators, setThreadActivityIndicators] = useState<Record<string, UiThreadActivityIndicator>>({});
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [localRunningTurns, setLocalRunningTurns] = useState<Record<string, TaskSummary>>({});
  const [draftTransition, setDraftTransition] = useState<{ threadId: string; projectName?: string } | null>(null);
  const [toolGroupCollapseMode, setToolGroupCollapseMode] = useState<ToolGroupCollapseMode>("alwaysExpanded");
  const [approvalDetailsCollapsedByDefault, setApprovalDetailsCollapsedByDefault] = useState(true);
  const [renderUserMessagesAsMarkdown, setRenderUserMessagesAsMarkdown] = useState(false);
  const [desktopSendBehavior, setDesktopSendBehavior] = useState<SendBehavior>("enter");
  const [mobileSendBehavior, setMobileSendBehavior] = useState<SendBehavior>("shiftEnter");
  const [historyCacheTurnLimit, setHistoryCacheTurnLimit] = useState(DEFAULT_HISTORY_CACHE_TURNS);
  const [sidebarWidth, setSidebarWidth] = useState(286);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(isMobileViewport());
  const [mobileJumpRailOpen, setMobileJumpRailOpen] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  const [authStatus, setAuthStatus] = useState<AuthStatus & { loaded: boolean }>({ enabled: true, authenticated: false, loaded: false });
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [savedPasswordEnabled, setSavedPasswordEnabled] = useState(() => hasSavedPassword());
  const activeThreadIdRef = useRef<string | null>(null);
  const workspacesRef = useRef<UiWorkspace[]>([]);
  const statusRef = useRef<StatusPayload | null>(null);
  const tasksRef = useRef<TaskSummary[]>([]);
  const statusRefreshInFlightRef = useRef(false);
  const activityStartedThreadIdsRef = useRef<Set<string>>(new Set());
  const userMessageCountByTurnRef = useRef<Record<string, number>>({});
  const autoLoginAttemptedRef = useRef(false);
  const authDecisionResolvedRef = useRef(false);
  const manualLoginWithoutRememberRef = useRef(false);
  const pendingThreadShellsRef = useRef<Map<string, PendingThreadShell>>(new Map());
  const restoredThreadLoadAttemptRef = useRef<string | null>(null);
  const authReady = authStatus.loaded && (!authStatus.enabled || authStatus.authenticated);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    pendingCompactTurnsRef.current = pendingCompactTurns;
  }, [pendingCompactTurns]);

  useEffect(() => {
    pendingCompactMessagesRef.current = pendingCompactMessages;
  }, [pendingCompactMessages]);

  useEffect(() => {
    if (!authReady) return;
    writeStoredActiveSelection(activeCwd, activeThreadId);
  }, [authReady, activeCwd, activeThreadId]);

  useEffect(() => {
    void refreshAuthStatus();
  }, []);

  useEffect(() => {
    if (!authStatus.loaded || !authStatus.enabled || authStatus.authenticated || autoLoginAttemptedRef.current) return;
    const savedPassword = readSavedPassword();
    if (!savedPassword) return;
    autoLoginAttemptedRef.current = true;
    void login(savedPassword, true, { silent: true }).catch(() => {
      clearSavedPassword();
    });
  }, [authStatus.loaded, authStatus.enabled, authStatus.authenticated]);

  useEffect(() => {
    if (!authStatus.loaded || !authStatus.enabled || authDecisionResolvedRef.current) return;
    if (authStatus.authenticated) {
      if (!savedPasswordEnabled && !manualLoginWithoutRememberRef.current) {
        authDecisionResolvedRef.current = true;
        void logout();
        return;
      }
      authDecisionResolvedRef.current = true;
      manualLoginWithoutRememberRef.current = false;
      return;
    }
    if (!savedPasswordEnabled) {
      authDecisionResolvedRef.current = true;
      manualLoginWithoutRememberRef.current = false;
    }
  }, [authStatus.loaded, authStatus.enabled, authStatus.authenticated, savedPasswordEnabled]);

  useEffect(() => {
    function handleAuthRequired() {
      setAuthStatus((current) => ({ ...current, enabled: true, authenticated: false, loaded: true }));
    }
    window.addEventListener("codex-auth-required", handleAuthRequired);
    return () => window.removeEventListener("codex-auth-required", handleAuthRequired);
  }, []);

  useEffect(() => {
    if (!authReady) return;
    void refreshProjectsAndThreads();
    void refreshStatus();
    void refreshCapabilities();
    void refreshApprovals();
    void loadPreferences();
    void api.themes().then(setThemes).catch((error) => {
      console.error("Failed to load themes", error);
      setThemes([]);
    });
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const timer = window.setInterval(() => {
      void refreshStatus();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [authReady]);

  useEffect(() => {
    if (!draftTransition) return;
    const timer = window.setTimeout(() => setDraftTransition(null), 420);
    return () => window.clearTimeout(timer);
  }, [draftTransition]);

  useEffect(() => {
    if (!authReady || !preferencesLoaded) return;
    const timer = window.setTimeout(() => {
      void api.updatePreferences(currentPreferences({
        colorMode,
        activeThemeId,
        toolGroupCollapseMode,
        approvalDetailsCollapsedByDefault,
        renderUserMessagesAsMarkdown,
        desktopSendBehavior,
        mobileSendBehavior,
        historyCacheTurnLimit,
        sidebarWidth,
        sidebarCollapsed,
        model,
        workMode,
        effort
      })).catch((error) => {
        console.error("Failed to save preferences", error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [authReady, preferencesLoaded, colorMode, activeThemeId, toolGroupCollapseMode, approvalDetailsCollapsedByDefault, renderUserMessagesAsMarkdown, desktopSendBehavior, mobileSendBehavior, historyCacheTurnLimit, sidebarWidth, sidebarCollapsed, model, workMode, effort]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    function applyMobileDefaults() {
      setIsMobileLayout(query.matches);
      if (query.matches) {
        setSidebarCollapsed(true);
      } else {
        setMobileJumpRailOpen(false);
      }
    }
    applyMobileDefaults();
    query.addEventListener("change", applyMobileDefaults);
    return () => query.removeEventListener("change", applyMobileDefaults);
  }, []);

  useEffect(() => {
    if (!isMobileLayout) {
      setMobileJumpRailOpen(false);
    }
  }, [isMobileLayout]);

  useEffect(() => {
    if (!authReady) return;
    const ws = new WebSocket(wsUrl());
    ws.addEventListener("message", (message) => {
      const parsed = safeJson(message.data);
      if (!parsed) return;
      if (parsed.type === "hello") {
        if (Array.isArray(parsed.tasks)) {
          const runningTasks = onlyRunningTasks(parsed.tasks);
          activityStartedThreadIdsRef.current = new Set(runningTasks.map((task) => task.threadId));
          setThreadActivityIndicators(Object.fromEntries(runningTasks.map((task) => [task.threadId, "running"])));
          tasksRef.current = runningTasks;
          setTasks(runningTasks);
        }
        if (Array.isArray(parsed.pendingServerRequests)) setPendingApprovals(parsed.pendingServerRequests);
        if (Array.isArray(parsed.events)) {
          parsed.events.forEach((event: BridgeEventLike) => applyBridgeEvent(event, { replay: true }));
        }
        return;
      }
      if (parsed.type === "event") {
        applyBridgeEvent(parsed.event as BridgeEventLike);
      }
    });
    return () => ws.close();
  }, [authReady]);

  useEffect(() => {
    if (!authReady || !activeThreadId || !activeCwd) return;
    const target = activeThread(workspaces, activeThreadId);
    if (!target || target.isDraft || target.messages.length > 0 || target.isLoadingHistory) return;
    const restoreKey = `${activeCwd}\n${activeThreadId}`;
    if (restoredThreadLoadAttemptRef.current === restoreKey) return;
    restoredThreadLoadAttemptRef.current = restoreKey;
    void selectThread(activeThreadId, target.cwd ?? activeCwd, { workspaces });
  }, [authReady, activeCwd, activeThreadId, workspaces]);

  async function refreshProjectsAndThreads() {
    try {
      const [projects, threadsResult] = await Promise.all([
        api.projects(),
        api.threads()
      ]);
      const serverThreads = Array.isArray(threadsResult) ? threadsResult : threadsResult.data ?? [];
      const threads = withPendingThreadShells(serverThreads);
      const merged = mergeThreadsIntoProjects(projects, threads, workspacesRef.current);
      const selectedThread = activeThread(merged, activeThreadIdRef.current);
      setWorkspaceLoadError(null);
      setWorkspaces(merged);
      setActiveCwd((current) => selectedThread?.cwd ?? (merged.some((workspace) => workspace.cwd === current) ? current : merged[0]?.cwd));
      setActiveThreadId((current) => current && activeThread(merged, current) ? current : null);
      return merged;
    } catch (error) {
      if (isAuthRequiredError(error)) {
        setAuthStatus((current) => ({ ...current, enabled: true, authenticated: false, loaded: true }));
        setWorkspaces([]);
        setActiveCwd(undefined);
        setActiveThreadId(null);
        setWorkspaceLoadError(null);
        return [];
      }
      console.error("Failed to load projects or threads", error);
      setWorkspaceLoadError("项目加载失败");
      return [];
    }
  }

  async function refreshStatus() {
    if (statusRefreshInFlightRef.current) return;
    statusRefreshInFlightRef.current = true;
    try {
      const nextStatus = await api.status();
      const runningTurns = onlyRunningTasks(nextStatus.runningTurns ?? []);
      if (!sameJson(statusRef.current, nextStatus)) {
        statusRef.current = nextStatus;
        setStatus(nextStatus);
      }
      syncThreadActivityIndicators(tasksRef.current, runningTurns);
      if (!sameJson(tasksRef.current, runningTurns)) {
        tasksRef.current = runningTurns;
        setTasks(runningTurns);
      }
      reconcileLocalRunningTurns(runningTurns);
    } catch (error) {
      if (isAuthRequiredError(error)) {
        setAuthStatus((current) => ({ ...current, enabled: true, authenticated: false, loaded: true }));
        return;
      }
      console.error("Failed to refresh status", error);
    } finally {
      statusRefreshInFlightRef.current = false;
    }
  }

  async function loadPreferences() {
    try {
      applyPreferences(await api.preferences());
    } catch (error) {
      console.error("Failed to load preferences", error);
    } finally {
      setPreferencesLoaded(true);
    }
  }

  function applyPreferences(preferences: UserPreferences) {
    setColorMode(preferences.colorMode);
    setActiveThemeId(preferences.activeThemeId);
    setToolGroupCollapseMode(preferences.toolGroupCollapseMode ?? (preferences.collapseToolGroupsByDefault ? "alwaysCollapsed" : "alwaysExpanded"));
    setApprovalDetailsCollapsedByDefault(Boolean(preferences.approvalDetailsCollapsedByDefault));
    setRenderUserMessagesAsMarkdown(Boolean(preferences.renderUserMessagesAsMarkdown));
    setDesktopSendBehavior(normalizeSendBehavior(preferences.desktopSendBehavior ?? preferences.sendBehavior, "enter"));
    setMobileSendBehavior(normalizeSendBehavior(preferences.mobileSendBehavior ?? preferences.sendBehavior, "shiftEnter"));
    setHistoryCacheTurnLimit(clampNumber(preferences.historyCacheTurnLimit, MIN_HISTORY_CACHE_TURNS, MAX_HISTORY_CACHE_TURNS, DEFAULT_HISTORY_CACHE_TURNS));
    setSidebarWidth(clampNumber(preferences.sidebarWidth, 240, 520, 286));
    setSidebarCollapsed(isMobileViewport() ? true : Boolean(preferences.sidebarCollapsed));
    setModel(preferences.defaultModel ?? "");
    setWorkMode(preferences.defaultWorkMode);
    setEffort(preferences.defaultEffort);
  }

  async function refreshCapabilities() {
    try {
      const nextCapabilities = await api.capabilities();
      setCapabilities(nextCapabilities);
    } catch (error) {
      console.error("Failed to load capabilities", error);
    }
  }

  async function refreshApprovals() {
    try {
      setPendingApprovals(await api.approvals());
    } catch (error) {
      console.error("Failed to load approvals", error);
    }
  }

  async function refreshCurrentView() {
    const threadId = activeThreadIdRef.current;
    const currentThread = threadId ? activeThread(workspacesRef.current, threadId) : undefined;
    const cwd = currentThread?.cwd ?? activeCwd;
    const [merged] = await Promise.all([
      refreshProjectsAndThreads(),
      refreshStatus(),
      refreshCapabilities(),
      refreshApprovals()
    ]);
    if (!threadId) return;
    const refreshedThread = activeThread(merged, threadId);
    const refreshedCwd = refreshedThread?.cwd ?? cwd;
    if (!refreshedThread || !refreshedCwd) return;
    await selectThread(threadId, refreshedCwd, { force: true, workspaces: merged });
  }

  function withPendingThreadShells(serverThreads: ThreadSummary[]): ThreadSummary[] {
    const now = Date.now();
    const serverIds = new Set(serverThreads.map((thread) => thread.id));
    const pending: ThreadSummary[] = [];
    for (const [threadId, shell] of pendingThreadShellsRef.current.entries()) {
      if (serverIds.has(threadId) || now - shell.createdAt > PENDING_THREAD_SHELL_TTL_MS) {
        pendingThreadShellsRef.current.delete(threadId);
        continue;
      }
      pending.push({
        id: shell.id,
        cwd: shell.cwd,
        name: shell.title,
        preview: shell.title,
        updatedAt: shell.updatedAt,
        status: "completed"
      });
    }
    return pending.length ? [...serverThreads, ...pending] : serverThreads;
  }

  function rememberPendingThreadShell(cwd: string, threadId: string, title = "新对话") {
    const now = Date.now();
    const shell: PendingThreadShell = { id: threadId, cwd, title, updatedAt: now, createdAt: now };
    pendingThreadShellsRef.current.set(threadId, shell);
    setWorkspaces((current) => upsertPendingThreadShell(current, shell));
  }

  async function login(password: string, remember: boolean, options: { silent?: boolean } = {}) {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await api.login({ password, remember });
      manualLoginWithoutRememberRef.current = !remember;
      if (remember) {
        window.localStorage.setItem(SAVED_PASSWORD_KEY, password);
      } else {
        window.localStorage.removeItem(SAVED_PASSWORD_KEY);
      }
      setSavedPasswordEnabled(remember);
      setAuthStatus({ enabled: true, authenticated: true, loaded: true });
    } catch (error) {
      if (!options.silent) setAuthError("密码错误");
      throw error;
    } finally {
      setAuthLoading(false);
    }
  }

  function clearSavedPassword() {
    window.localStorage.removeItem(SAVED_PASSWORD_KEY);
    setSavedPasswordEnabled(false);
  }

  async function refreshAuthStatus() {
    try {
      const status = await api.authStatus();
      setAuthStatus({ ...status, loaded: true });
      setAuthError(null);
      if (!status.enabled) {
        authDecisionResolvedRef.current = true;
      }
    } catch (error) {
      console.error("Failed to load auth status", error);
      setAuthStatus({ enabled: true, authenticated: false, loaded: true });
      setAuthError("无法确认登录状态");
    }
  }

  async function logout() {
    await api.logout().catch((error) => console.error("Failed to logout", error));
    setAuthStatus((current) => ({ ...current, authenticated: false, loaded: true }));
  }

  async function toggleSkill(path: string, enabled: boolean) {
    setCapabilities((current) => updateSkillCapability(current, path, enabled));
    await api.setSkillEnabled({ path, enabled });
    await refreshCapabilities();
  }

  async function togglePlugin(pluginId: string, enabled: boolean) {
    setCapabilities((current) => updatePluginCapability(current, pluginId, enabled));
    await api.setPluginEnabled(pluginId, enabled);
    await refreshCapabilities();
  }

  function reconcileLocalRunningTurns(serverRunningTurns: TaskSummary[]) {
    const serverThreadIds = new Set(onlyRunningTasks(serverRunningTurns).map((task) => task.threadId));
    const now = Date.now();
    setLocalRunningTurns((current) => {
      const next: Record<string, TaskSummary> = {};
      for (const [threadId, task] of Object.entries(current)) {
        const ageMs = now - Date.parse(task.startedAt);
        if (serverThreadIds.has(threadId) || ageMs < 5000) {
          next[threadId] = task;
        } else {
          finishPendingAssistant(threadId, "");
          markThreadActivityFinished(threadId, "completed");
        }
      }
      return next;
    });
  }

  function syncThreadActivityIndicators(previousRunningTurns: TaskSummary[], nextRunningTurns: TaskSummary[]) {
    const previousByThread = new Set(onlyRunningTasks(previousRunningTurns).map((task) => task.threadId));
    const runningTurns = onlyRunningTasks(nextRunningTurns);
    const nextByThread = new Set(runningTurns.map((task) => task.threadId));
    for (const task of runningTurns) {
      markThreadActivityRunning(task.threadId);
    }
    for (const threadId of previousByThread) {
      if (!nextByThread.has(threadId)) {
        markThreadActivityFinished(threadId, "completed");
      }
    }
  }

  function applyBridgeEvent(event: BridgeEventLike, options: BridgeEventOptions = {}) {
    if (event.type.startsWith("codex.request.") || event.type === "codex.serverRequest/resolved") {
      void refreshApprovals();
    }
    if (event.type === "codex.item/agentMessage/delta") {
      const delta = readPath<string>(event, ["payload", "params", "delta"]);
      const itemId = readPath<string>(event, ["payload", "params", "itemId"]);
      if (event.threadId && itemId && delta) {
        appendAssistantDelta(event.threadId, event.turnId, itemId, delta);
      }
      return;
    }
    if (event.type === "codex.item/reasoning/textDelta" || event.type === "codex.item/reasoning/summaryTextDelta") {
      const delta = readPath<string>(event, ["payload", "params", "delta"]);
      const itemId = readPath<string>(event, ["payload", "params", "itemId"]) ?? readPath<string>(event, ["payload", "params", "summaryPartId"]);
      if (event.threadId && itemId && delta) {
        appendReasoningDelta(event.threadId, event.turnId, itemId, delta);
      }
      return;
    }
    if (event.type === "codex.item/reasoning/summaryPartAdded") {
      const itemId = readPath<string>(event, ["payload", "params", "itemId"]) ?? readPath<string>(event, ["payload", "params", "summaryPartId"]);
      const text = readPath<string>(event, ["payload", "params", "text"]) ?? readPath<string>(event, ["payload", "params", "summaryPart", "text"]);
      if (event.threadId && itemId && text) {
        replaceReasoningPart(event.threadId, event.turnId, itemId, text);
      }
      return;
    }
    if (event.type === "codex.rawResponseItem/completed") {
      const item = readPath<Record<string, unknown>>(event, ["payload", "params", "item"]);
      const rawToolCall = normalizeRawResponseToolCall(item);
      if (event.threadId && rawToolCall) {
        upsertToolCall(event.threadId, event.turnId, rawToolCall);
        return;
      }
      const rawToolOutput = normalizeRawResponseToolOutput(item);
      if (event.threadId && rawToolOutput) {
        updateToolCall(event.threadId, event.turnId, rawToolOutput.id, (toolCall) => ({
          ...toolCall,
          status: "completed",
          result: rawToolOutput.output,
          aggregatedOutput: typeof rawToolOutput.output === "string" ? rawToolOutput.output : formatJsonValue(rawToolOutput.output)
        }));
        return;
      }
    }
    if (event.type === "codex.item/completed") {
      const item = readPath<Record<string, unknown>>(event, ["payload", "params", "item"]);
      if (event.threadId && isContextCompactionItem(item)) {
        bindPendingCompactTurn(event.threadId, event.turnId);
        upsertContextCompactionMarker(event.threadId, event.turnId, item, "上下文已压缩", event);
        return;
      }
      if (event.threadId && event.turnId && item?.type === "userMessage") {
        const seen = userMessageCountByTurnRef.current[event.turnId] ?? 0;
        userMessageCountByTurnRef.current[event.turnId] = seen + 1;
        const text = textFromUserItem(item);
        if (seen > 0 && text) {
          upsertAssistantSteer(event.threadId, event.turnId, {
            id: String(item.id ?? `steer-${event.turnId}-${seen}`),
            text,
            status: "sent"
          });
        }
        return;
      }
      if (event.threadId && item?.type === "agentMessage" && typeof item.id === "string" && typeof item.text === "string") {
        replaceAssistantMessage(event.threadId, event.turnId, item.id, item.text);
        return;
      }
      if (event.threadId && isCodexToolItem(item)) {
        upsertToolCall(event.threadId, event.turnId, normalizeToolCallFromItem(item));
      }
      return;
    }
    if (event.type === "codex.item/started") {
      const item = readPath<Record<string, unknown>>(event, ["payload", "params", "item"]);
      if (event.threadId && isContextCompactionItem(item)) {
        const isManualCompact = Boolean(pendingCompactTurnsRef.current[event.threadId]);
        bindPendingCompactTurn(event.threadId, event.turnId);
        if (isManualCompact) {
          markCompactGenerating(event.threadId, event.turnId);
        }
        markThreadActivityRunning(event.threadId);
        return;
      }
      if (event.threadId && isCodexToolItem(item)) {
        upsertToolCall(event.threadId, event.turnId, normalizeToolCallFromItem(item));
      }
      return;
    }
    if (event.type === "codex.thread/compacted" || event.type === "thread/compacted") {
      const threadId = event.threadId ?? readPath<string>(event, ["payload", "params", "threadId"]) ?? readPath<string>(event, ["payload", "threadId"]);
      const turnId = event.turnId ?? readPath<string>(event, ["payload", "params", "turnId"]) ?? readPath<string>(event, ["payload", "turnId"]);
      if (threadId) {
        bindPendingCompactTurn(threadId, turnId);
        upsertContextCompactionMarker(threadId, turnId, undefined, "上下文已压缩", event);
      }
      return;
    }
    if (event.type === "codex.item/fileChange/patchUpdated") {
      const itemId = readPath<string>(event, ["payload", "params", "itemId"]);
      const changes = readPath<unknown>(event, ["payload", "params", "changes"]);
      if (event.threadId && itemId) {
        upsertToolCall(event.threadId, event.turnId, normalizeToolCallFromItem({
          id: itemId,
          type: "fileChange",
          status: "inProgress",
          changes
        }));
      }
      return;
    }
    if (event.type === "codex.item/fileChange/outputDelta") {
      const itemId = readPath<string>(event, ["payload", "params", "itemId"]);
      const delta = readPath<string>(event, ["payload", "params", "delta"]);
      if (event.threadId && itemId && delta) {
        updateToolCall(event.threadId, event.turnId, itemId, (toolCall) => ({
          ...toolCall,
          aggregatedOutput: `${toolCall.aggregatedOutput ?? ""}${delta}`
        }));
      }
      return;
    }
    if (event.type === "turn.started" || event.type === "turn.completed") {
      if (event.threadId) {
        if (event.type === "turn.started") {
          const turnId = event.turnId ?? readPath<string>(event, ["payload", "turnId"]);
          const startedAt = normalizeTurnStartedAt(event);
          if (turnId) userMessageCountByTurnRef.current[turnId] = 0;
          if (!options.replay) {
            if (event.threadId && turnId && pendingCompactTurnsRef.current[event.threadId]) {
              bindPendingCompactTurn(event.threadId, turnId);
              markCompactGenerating(event.threadId, turnId);
            }
            if (turnId) markThreadGenerating(event.threadId, turnId, startedAt);
            markQueuedSteersSent(event.threadId);
          }
        } else {
          const endStatus = eventThreadStatus(event);
          const completedTurnId = event.turnId ?? readPath<string>(event, ["payload", "turnId"]) ?? readPath<string>(event, ["payload", "params", "turn", "id"]);
          const completedTask = findTaskByTurn(event.threadId, completedTurnId);
          const wasCompactTurn = completedTask?.kind === "compact" || threadHasCompactAssistant(event.threadId, completedTurnId);
          markThreadFinished(event.threadId, normalizeTurnTiming(event), turnStatusLine(endStatus, event));
          if (!options.replay) {
            markThreadActivityFinished(event.threadId, endStatus === "failed" || endStatus === "interrupted" ? "failed" : "completed");
            if (wasCompactTurn && endStatus !== "failed" && endStatus !== "interrupted") {
              flushPendingCompactMessages(event.threadId);
            }
          }
        }
      }
      if (!options.replay) void refreshStatus();
      return;
    }
    if (event.type === "codex.thread/tokenUsage/updated") {
      if (event.threadId) updateTurnTokenUsage(event.threadId, event.turnId ?? readPath<string>(event, ["payload", "params", "turnId"]), normalizeTokenUsage(event));
    }
    if (event.type === "codex.thread/name/updated") {
      const name = readPath<string>(event, ["payload", "params", "name"]);
      if (event.threadId && name) renameThreadLocal(event.threadId, name);
    }
    if (event.type === "codex.thread/settings/updated") {
      const settings = readPath<Record<string, unknown>>(event, ["payload", "params", "threadSettings"]);
      if (settings && event.threadId === activeThreadId) {
        const nextWorkMode = workModeFromSettings(settings);
        if (nextWorkMode) setWorkMode(nextWorkMode);
        const nextModel = typeof settings.model === "string" ? settings.model : undefined;
        if (nextModel !== undefined) setModel(nextModel);
        const nextEffort = settings.effort as ReasoningEffort | null | undefined;
        if (isReasoningEffort(nextEffort)) setEffort(nextEffort);
      }
    }
  }

  function appendAssistantDelta(threadId: string, turnId: string | undefined, itemId: string, delta: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => appendAssistantTextPartDelta(message, itemId, delta))
        };
      })
    })));
  }

  function appendReasoningDelta(threadId: string, turnId: string | undefined, itemId: string, delta: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            assistantParts: appendAssistantReasoningPartDelta(message.assistantParts, itemId, delta),
            isStreaming: true
          }))
        };
      })
    })));
  }

  function replaceReasoningPart(threadId: string, turnId: string | undefined, itemId: string, text: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            assistantParts: upsertAssistantReasoningPart(message.assistantParts, itemId, text),
            isStreaming: true
          }))
        };
      })
    })));
  }

  function replaceAssistantMessage(threadId: string, turnId: string | undefined, itemId: string, text: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => replaceAssistantTextPart(message, itemId, text))
        };
      })
    })));
  }

  function upsertToolCall(threadId: string, turnId: string | undefined, toolCall: UiToolCall) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            assistantParts: upsertAssistantToolPart(message.assistantParts, toolCall),
            isStreaming: message.isStreaming || toolCall.status === "inProgress"
          }))
        };
      })
    })));
  }

  function updateToolCall(threadId: string, turnId: string | undefined, itemId: string, updater: (toolCall: UiToolCall) => UiToolCall) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            assistantParts: updateAssistantToolPart(message.assistantParts, itemId, updater),
            isStreaming: true
          }))
        };
      })
    })));
  }

  function updateTurnTokenUsage(threadId: string, turnId: string | undefined, tokenUsage: UiMessage["tokenUsage"] | undefined) {
    if (!tokenUsage) return;
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            tokenUsage
          }))
        };
      })
    })));
  }

  function upsertContextCompactionMarker(threadId: string, turnId: string | undefined, item: Record<string, unknown> | undefined, text: string, event?: BridgeEventLike) {
    const marker = {
      ...normalizeContextCompactionMarker({
        id: String(item?.id ?? turnId ?? (event?.seq != null ? `context-compaction-${event.seq}` : `context-compaction-${threadId}`)),
        turnId,
        createdAt: parseEventCreatedAt(event) ?? Date.now()
      }),
      text
    };
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return { ...thread, messages: upsertContextCompactionMarkerMessage(thread.messages, marker) };
      })
    })));
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark", colorMode === "dark");
    document.documentElement.dataset.theme = colorMode;
  }, [colorMode]);

  useEffect(() => {
    let style = document.getElementById("codex-web-custom-theme") as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement("style");
      style.id = "codex-web-custom-theme";
      document.head.append(style);
    }
    const theme = themes.find((item) => item.id === activeThemeId) ?? themes.find((item) => item.id === "default");
    style.textContent = theme?.css ?? "";
  }, [activeThemeId, themes]);

  async function addWorkspace(cwd: string) {
    const [projects, threadsResult] = await Promise.all([
      api.addProject(cwd),
      api.threads(cwd)
    ]);
    const threads = Array.isArray(threadsResult) ? threadsResult : threadsResult.data ?? [];
    setWorkspaces((current) => mergeThreadsIntoProjects(projects, threads, current));
    setActiveCwd(cwd);
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
  }

  async function updateProjects(operation: Promise<Array<{ cwd: string; name: string; updatedAt: number }>>) {
    const projects = await operation;
    setWorkspaces((current) => mergeProjectRecords(projects, current));
  }

  async function restoreProject(cwd: string) {
    await updateProjects(api.restoreProject(cwd));
    setActiveCwd(cwd);
    setActiveThreadId(null);
    activeThreadIdRef.current = null;
    await refreshProjectsAndThreads();
  }

  async function quickCreateWorkspace() {
    const result = await api.quickCreateProject();
    setWorkspaces((current) => mergeProjectRecords(result.projects, current));
    const cwd = result.project?.cwd ?? result.projects[0]?.cwd;
    if (cwd) {
      setActiveCwd(cwd);
      setActiveThreadId(null);
      activeThreadIdRef.current = null;
    }
  }

  function createThread(cwd?: string) {
    if (!cwd) return;
    const workspace = workspaces.find((item) => item.cwd === cwd);
    const existingDraft = workspace?.threads.find((thread) => thread.isDraft);
    if (existingDraft) {
      setActiveCwd(cwd);
      setActiveThreadId(existingDraft.id);
      return;
    }
    const thread = {
      id: createClientId(),
      cwd,
      title: "新对话",
      updatedAt: Date.now(),
      isDraft: true,
      needsResume: false,
      messages: []
    };
    setWorkspaces((current) => current.map((workspace) => (
      workspace.cwd === cwd
        ? { ...workspace, updatedAt: thread.updatedAt, threads: [thread, ...workspace.threads] }
        : workspace
    )));
    setActiveCwd(cwd);
    setActiveThreadId(thread.id);
  }

  async function queueSteerMessage(threadId: string, turnId: string, text: string) {
    const id = createClientId();
    const item: QueuedSteerMessage = { id, text, status: "queued" };
    setQueuedSteers((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), item]
    }));
    upsertAssistantSteer(threadId, turnId, item);
    try {
      await api.steer(threadId, text, turnId);
      upsertAssistantSteer(threadId, turnId, { ...item, status: "sent" });
      setQueuedSteers((current) => ({
        ...current,
        [threadId]: (current[threadId] ?? []).map((queued) => queued.id === id ? { ...queued, status: "sent" } : queued)
      }));
    } catch {
      upsertAssistantSteer(threadId, turnId, { ...item, status: "failed" });
      setQueuedSteers((current) => ({
        ...current,
        [threadId]: (current[threadId] ?? []).map((queued) => queued.id === id ? { ...queued, status: "failed" } : queued)
      }));
    }
  }

  function removeQueuedSteer(threadId: string, steerId: string) {
    removeAssistantSteer(threadId, steerId);
    setQueuedSteers((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((item) => item.id !== steerId || item.status === "sent")
    }));
    setPendingCompactMessages((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).filter((item) => item.id !== steerId)
    }));
  }

  function upsertAssistantSteer(threadId: string, turnId: string, steer: QueuedSteerMessage) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: withAssistantTurnMessage(thread, turnId, (message) => ({
            ...message,
            steerMessages: upsertSteerList(message.steerMessages, steer),
            assistantParts: upsertAssistantSteerPart(message.assistantParts, steer)
          }))
        };
      })
    })));
  }

  function removeAssistantSteer(threadId: string, steerId: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => {
        if (thread.id !== threadId) return thread;
        return {
          ...thread,
          messages: thread.messages.map((message) => ({
            ...message,
            steerMessages: removeSteerFromList(message.steerMessages, steerId),
            assistantParts: removeAssistantSteerPart(message.assistantParts, steerId)
          }))
        };
      })
    })));
  }

  function markQueuedSteersSent(threadId: string) {
    setQueuedSteers((current) => ({
      ...current,
      [threadId]: (current[threadId] ?? []).map((item) => item.status === "queued" ? { ...item, status: "sent" } : item)
    }));
  }

  async function sendMessage(text: string, attachments: UploadedAttachment[]) {
    const targetThread = activeThread(workspaces, activeThreadId);
    const targetCwd = activeCwd ?? targetThread?.cwd;
    if (!targetCwd) throw new Error("请先选择项目");
    if (commandMode === "goal") {
      const objective = text.trim();
      if (!objective) return;
      let threadId = activeThreadId;
      if (!targetThread || targetThread.isDraft || targetThread.messages.length === 0) {
        const created = await api.startThread({ cwd: targetCwd, ...threadOverridesFor(workMode, model) });
        const createdThreadId = created.thread?.id;
        if (!createdThreadId) throw new Error("无法创建目标会话");
        threadId = createdThreadId;
        rememberPendingThreadShell(targetCwd, threadId);
        setActiveThreadId(threadId);
        activeThreadIdRef.current = threadId;
      }
      if (!threadId) throw new Error("无法创建目标会话");
      await api.setThreadGoal(threadId, { objective, status: "active" });
      await refreshProjectsAndThreads();
      return;
    }
    const runningTask = activeThreadId ? runningTaskFor(activeThreadId, allRunningTasks(tasks, localRunningTurns)) : undefined;
    if (activeThreadId && runningTask?.kind === "compact" && (text.trim() || attachments.length)) {
      queuePendingCompactMessage(activeThreadId, text.trim(), attachments);
      return;
    }
    if (activeThreadId && runningTask?.turnId && text.trim()) {
      await queueSteerMessage(activeThreadId, runningTask.turnId, text.trim());
      return;
    }
    const images = attachments.filter((attachment) => attachment.kind === "image");
    const files = attachments.filter((attachment) => attachment.kind === "file");
    const codexText = textWithFilePaths(text, files);
    const threadOverrides = threadOverridesFor(workMode, model);
    const turnOverrides = turnOverridesFor(workMode, model, effort, commandMode);
    const input = buildTurnInput(codexText, images);
    let realThreadId = targetThread?.id ?? activeThreadId ?? "";
    try {
      if (!targetThread || targetThread.isDraft) {
        const created = await api.startThread({ cwd: targetCwd, ...threadOverrides });
        realThreadId = created.thread?.id ?? "";
        if (!realThreadId) throw new Error("无法创建目标会话");
        rememberPendingThreadShell(targetCwd, realThreadId);
        setDraftTransition({ threadId: realThreadId, projectName: selectedWorkspace?.name });
        setActiveThreadId(realThreadId);
        activeThreadIdRef.current = realThreadId;
        await selectThread(realThreadId, targetCwd, { force: true });
      }
      if (!realThreadId) throw new Error("无法创建目标会话");
      if (targetThread?.needsResume) {
        await api.resumeThread(realThreadId);
        markThreadResumed(targetThread.cwd, realThreadId);
      }
      const turnResult = await api.startTurn(realThreadId, codexText.trim(), turnOverrides, input);
      const turnId = readPath<string>(turnResult, ["turn", "id"]) ?? readPath<string>(turnResult, ["turnId"]);
      if (turnId) {
        appendOptimisticTurn(realThreadId, turnId, codexText, attachments);
        markThreadGenerating(realThreadId, turnId);
      }
      if (targetThread && !targetThread.isDraft) {
        await selectThread(realThreadId, targetCwd, { force: true });
      }
      void refreshProjectsAndThreads();
      window.setTimeout(() => {
        void refreshStatus();
      }, 1200);
    } catch (error) {
      if (realThreadId) {
        markThreadFinished(realThreadId);
        markThreadActivityFinished(realThreadId, "failed");
        finishPendingAssistant(realThreadId, "", error instanceof Error ? error.message : "生成失败", "danger");
      }
      throw error;
    }
  }

  function buildTurnInput(codexText: string, images: Extract<UploadedAttachment, { kind: "image" }>[]): Array<Record<string, unknown>> {
    return [
      ...(codexText.trim() ? [{ type: "text", text: codexText.trim(), text_elements: [] }] : []),
      ...images.map((image) => image.input)
    ];
  }

  async function sendMessageToExistingThread(threadId: string, text: string, attachments: UploadedAttachment[]) {
    const targetThread = activeThread(workspacesRef.current, threadId);
    if (!targetThread) return;
    const images = attachments.filter((attachment): attachment is Extract<UploadedAttachment, { kind: "image" }> => attachment.kind === "image");
    const files = attachments.filter((attachment): attachment is Extract<UploadedAttachment, { kind: "file" }> => attachment.kind === "file");
    const codexText = textWithFilePaths(text, files);
    const input = buildTurnInput(codexText, images);
    try {
      if (targetThread.needsResume) {
        await api.resumeThread(threadId);
        markThreadResumed(targetThread.cwd, threadId);
      }
      const turnResult = await api.startTurn(threadId, codexText.trim(), turnOverridesFor(workMode, model, effort, commandMode), input);
      const turnId = readPath<string>(turnResult, ["turn", "id"]) ?? readPath<string>(turnResult, ["turnId"]);
      if (turnId) {
        appendOptimisticTurn(threadId, turnId, codexText, attachments);
        markThreadGenerating(threadId, turnId);
      }
      await selectThread(threadId, targetThread.cwd, { force: true });
      window.setTimeout(() => {
        void refreshStatus();
      }, 1200);
    } catch (error) {
      markThreadFinished(threadId);
      markThreadActivityFinished(threadId, "failed");
      finishPendingAssistant(threadId, "", error instanceof Error ? error.message : "生成失败", "danger");
    }
  }

  async function runCompact() {
    if (!selectedThread || selectedThread.isDraft) return;
    trackManualCompactTurn(selectedThread.id);
    try {
      await api.compactThread(selectedThread.id);
      await selectThread(selectedThread.id, selectedThread.cwd, { force: true });
      window.setTimeout(() => {
        void refreshStatus();
      }, 800);
    } catch (error) {
      clearManualCompactTurn(selectedThread.id);
      markThreadActivityFinished(selectedThread.id, "failed");
      console.error("Failed to compact thread", error);
    }
  }

  async function runInit() {
    if (!activeCwd) return;
    const initPrompt = [
      "Generate a file named AGENTS.md that serves as a contributor guide for this repository.",
      "Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.",
      "Follow the outline below, but adapt as needed. Add sections if relevant, and omit those that do not apply to this project.",
      "",
      "Document Requirements",
      "",
      "- Title the document \"Repository Guidelines\".",
      "- Use Markdown headings (#, ##, etc.) for structure.",
      "- Keep the document concise. 200-400 words is optimal.",
      "- Keep explanations short, direct, and specific to this repository.",
      "- Provide examples where helpful, such as commands, directory paths, and naming patterns.",
      "- Maintain a professional, instructional tone.",
      "",
      "Recommended Sections",
      "",
      "- Project Structure & Module Organization",
      "- Build, Test, and Development Commands",
      "- Coding Style & Naming Conventions",
      "- Testing Guidelines",
      "- Commit & Pull Request Guidelines",
      "- Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions if relevant"
    ].join("\n");
    await sendMessage(initPrompt, []);
  }

  async function stopGeneration(threadId: string | null) {
    if (!threadId) return;
    const task = runningTaskFor(threadId, allRunningTasks(tasks, localRunningTurns));
    if (!task?.turnId) return;
    const unsent = queuedSteers[threadId]?.filter((item) => item.status === "queued") ?? [];
    if (unsent.length) {
      setComposerText(unsent.map((item) => item.text).join("\n"));
      setQueuedSteers((current) => ({
        ...current,
        [threadId]: (current[threadId] ?? []).filter((item) => item.status !== "queued")
      }));
    }
    const pendingCompact = pendingCompactMessagesRef.current[threadId] ?? [];
    if (pendingCompact.length) {
      setComposerText(pendingCompact.map((item) => item.text).filter(Boolean).join("\n"));
      setComposerAttachments(pendingCompact.flatMap((item) => item.attachments));
      setPendingCompactMessages((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
    }
    await api.interrupt(threadId, task.turnId);
    markThreadFinished(threadId, { turnId: task.turnId, completedAt: Date.now() }, { text: "已停止生成", tone: "danger" });
    markThreadActivityFinished(threadId, "failed");
    finishPendingAssistant(threadId, "", "已停止生成", "danger");
    void refreshStatus();
  }

  function trackManualCompactTurn(threadId: string) {
    const startedAt = Date.now();
    setPendingCompactTurns((current) => ({
      ...current,
      [threadId]: {
        userMessageId: `compact-user-pending-${createClientId()}`,
        assistantMessageId: `compact-assistant-pending-${createClientId()}`,
        startedAt
      }
    }));
  }

  function clearManualCompactTurn(threadId: string) {
    setPendingCompactTurns((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  function bindPendingCompactTurn(threadId: string, turnId: string | undefined): void {
    if (!turnId) return;
    const pending = pendingCompactTurnsRef.current[threadId];
    if (!pending) return;
    clearManualCompactTurn(threadId);
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId
        ? {
            ...thread,
            messages: thread.messages.map((message) => {
              if (message.id === pending.userMessageId) {
                return { ...message, id: `compact-user-${turnId}`, turnId };
              }
              if (message.id === pending.assistantMessageId) {
                return {
                  ...message,
                  id: assistantTurnMessageId(turnId),
                  turnId,
                  turnStartedAt: message.turnStartedAt ?? pending.startedAt,
                  synthetic: "manualCompact"
                };
              }
              return message;
            })
          }
        : thread)
    })));
  }

  function markCompactGenerating(threadId: string, turnId: string | undefined) {
    if (!turnId) return;
    const startedAt = Date.now();
    setLocalRunningTurns((current) => ({
      ...current,
      [threadId]: {
        threadId,
        turnId,
        status: "running",
        kind: "compact",
        startedAt: current[threadId]?.startedAt ?? new Date(startedAt).toISOString(),
        lastEventAt: new Date(startedAt).toISOString(),
        lastSeq: current[threadId]?.lastSeq ?? 0,
        eventCount: current[threadId]?.eventCount ?? 0
      }
    }));
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId
        ? {
            ...thread,
            messages: withAssistantTurnMessage(thread, turnId, (message) => ({
              ...message,
              id: assistantTurnMessageId(turnId),
              turnId,
              isStreaming: true,
              turnStartedAt: message.turnStartedAt ?? startedAt,
              synthetic: "manualCompact"
            }))
          }
        : thread)
    })));
  }

  function queuePendingCompactMessage(threadId: string, text: string, attachments: UploadedAttachment[]) {
    const item: PendingCompactMessage = {
      id: createClientId(),
      text,
      attachments
    };
    setPendingCompactMessages((current) => ({
      ...current,
      [threadId]: [...(current[threadId] ?? []), item]
    }));
  }

  function flushPendingCompactMessages(threadId: string) {
    const pending = pendingCompactMessagesRef.current[threadId] ?? [];
    if (!pending.length) return;
    setPendingCompactMessages((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    const text = pending.map((item) => item.text).filter(Boolean).join("\n");
    const attachments = pending.flatMap((item) => item.attachments);
    void sendMessageToExistingThread(threadId, text, attachments);
  }

  function findTaskByTurn(threadId: string, turnId: string | undefined): TaskSummary | undefined {
    if (!turnId) return undefined;
    return allRunningTasks(tasksRef.current, localRunningTurns).find((task) => task.threadId === threadId && task.turnId === turnId);
  }

  function threadHasCompactAssistant(threadId: string, turnId: string | undefined): boolean {
    if (!turnId) return false;
    const thread = activeThread(workspacesRef.current, threadId);
    return Boolean(thread?.messages.some((message) => message.role === "assistant" && message.turnId === turnId && message.synthetic === "manualCompact"));
  }

  function pinThread(cwd: string, threadId: string) {
    updateThreadState(setWorkspaces, cwd, (threads) => {
      const target = threads.find((thread) => thread.id === threadId);
      if (!target) return threads;
      return sortUiThreads(threads.map((thread) => (
        thread.id === threadId ? { ...thread, pinned: !thread.pinned } : thread
      )));
    });
    void api.pinThread(cwd, threadId).then(() => refreshProjectsAndThreads()).catch(() => refreshProjectsAndThreads());
  }

  async function regenerateThreadTitle(cwd: string, threadId: string) {
    const thread = workspaces.find((workspace) => workspace.cwd === cwd)?.threads.find((item) => item.id === threadId);
    const fallback = titleFromMessage(thread?.messages.find((message) => message.role === "user")?.text || thread?.title || "新对话");
    try {
      const result = await api.generateThreadTitle(threadId);
      const title = generatedTitleFrom(result) ?? fallback;
      updateThreadState(setWorkspaces, cwd, (threads) => threads.map((item) => item.id === threadId ? { ...item, title } : item));
    } catch {
      updateThreadState(setWorkspaces, cwd, (threads) => threads.map((item) => item.id === threadId ? { ...item, title: fallback } : item));
    }
  }

  async function renameThread(cwd: string, threadId: string, title: string) {
    updateThreadState(setWorkspaces, cwd, (threads) => threads.map((thread) => (
      thread.id === threadId ? { ...thread, title } : thread
    )));
    await api.setThreadName(threadId, title).catch((error) => {
      console.error("Failed to rename thread", error);
    });
  }

  function renameThreadLocal(threadId: string, title: string) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId ? { ...thread, title } : thread)
    })));
  }

  async function rollbackToMessage(messageId: string) {
    if (!selectedThread) return;
    const messageIndex = selectedThread.messages.findIndex((message) => message.id === messageId);
    const clicked = selectedThread.messages[messageIndex];
    if (!clicked || clicked.role !== "user") return;
    const count = turnsFromUserMessage(selectedThread.messages, clicked.id);
    if (selectedThread.needsResume) {
      await api.resumeThread(selectedThread.id);
      markThreadResumed(selectedThread.cwd, selectedThread.id);
    }
    if (clicked.turnId) {
      await api.rollbackToTurn(selectedThread.id, clicked.turnId);
    } else if (count > 0) {
      await api.rollback(selectedThread.id, count);
    }
    setComposerText(clicked.text);
    setComposerAttachments(clicked.attachments ?? []);
    updateThread(selectedThread.cwd, selectedThread.id, {
      messages: selectedThread.messages.slice(0, messageIndex),
      needsResume: false
    });
  }

  async function forkFromMessage(messageId: string) {
    if (!selectedThread) return;
    if (selectedThread.needsResume) {
      await api.resumeThread(selectedThread.id);
      markThreadResumed(selectedThread.cwd, selectedThread.id);
    }
    const result = await api.forkThread(selectedThread.id, threadOverridesFor(workMode, model));
    const newThreadId = threadIdFromResult(result);
    if (newThreadId) {
      const title = uniqueBranchTitle(selectedThread.title, selectedWorkspace?.threads.map((thread) => thread.title) ?? []);
      const rollbackCount = turnsAfterMessage(selectedThread.messages, messageId);
      if (rollbackCount > 0) await api.rollback(newThreadId, rollbackCount);
      await api.setThreadName(newThreadId, title).catch(() => undefined);
      await refreshProjectsAndThreads();
      setActiveThreadId(newThreadId);
      activeThreadIdRef.current = newThreadId;
      setActiveCwd(selectedThread.cwd);
      renameThreadLocal(newThreadId, title);
      void selectThread(newThreadId, selectedThread.cwd);
    }
  }

  function exportThread(cwd: string, threadId: string) {
    const workspace = workspaces.find((item) => item.cwd === cwd);
    const thread = workspace?.threads.find((item) => item.id === threadId);
    if (!thread) return;
    const markdown = [
      `# ${thread.title}`,
      "",
      `项目：${workspace?.name ?? cwd}`,
      "",
      ...thread.messages.map((message) => `## ${message.role === "user" ? "用户" : "Codex"}\n\n${message.text || ""}`)
    ].join("\n");
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(thread.title)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function deleteThread(cwd: string, threadId: string) {
    updateThreadState(setWorkspaces, cwd, (threads) => threads.filter((thread) => thread.id !== threadId));
    if (threadId === activeThreadId) {
      setActiveThreadId(null);
      activeThreadIdRef.current = null;
      clearThreadActivityIndicator(threadId);
    }
    void api.deleteThread(cwd, threadId).then(() => refreshProjectsAndThreads()).catch((error) => {
      console.error("Failed to delete thread", error);
      void refreshProjectsAndThreads();
    });
  }

  async function restoreThread(cwd: string, threadId: string) {
    await api.restoreThread(cwd, threadId);
    await refreshProjectsAndThreads();
    setActiveCwd(cwd);
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
  }

  function moveThread(cwd: string, threadId: string, targetThreadId: string, placement: "before" | "after" = "before") {
    const threads = workspacesRef.current.find((workspace) => workspace.cwd === cwd)?.threads;
    const reordered = reorderThreadsForDrop(threads ?? [], threadId, targetThreadId, placement);
    if (!reordered) return;
    const orderedThreadIds = reordered.map((thread) => thread.id);
    updateThreadState(setWorkspaces, cwd, () => reordered);
    void api.moveThread(cwd, threadId, targetThreadId, placement, orderedThreadIds).then(() => refreshProjectsAndThreads()).catch(() => refreshProjectsAndThreads());
  }

  async function selectThread(threadId: string, cwd: string, options: { force?: boolean; workspaces?: UiWorkspace[] } = {}) {
    setActiveThreadId(threadId);
    activeThreadIdRef.current = threadId;
    setActiveCwd(cwd);
    if (threadActivityIndicators[threadId] && threadActivityIndicators[threadId] !== "running") {
      clearThreadActivityIndicator(threadId);
    }
    let sourceWorkspaces = options.workspaces ?? workspacesRef.current;
    let target = activeThread(sourceWorkspaces, threadId);
    if (!target) {
      const pendingShell = pendingThreadShellsRef.current.get(threadId);
      if (pendingShell) {
        sourceWorkspaces = upsertPendingThreadShell(workspacesRef.current, pendingShell);
        setWorkspaces(sourceWorkspaces);
        target = activeThread(sourceWorkspaces, threadId);
      }
    }
    if (!target || (!options.force && (target.messages.length > 0 || target.isLoadingHistory)) || (options.force && target.isLoadingHistory)) return;
    updateThread(cwd, threadId, { isLoadingHistory: true });
    try {
      const [thread, events] = await Promise.all([
        api.thread(threadId),
        api.events(threadId).catch(() => [])
      ]);
      const eventMessages = eventsToMessages(events);
      const runningTask = runningTaskFor(threadId, allRunningTasks(tasksRef.current, localRunningTurns));
      const loadedMessages = eventMessages.length ? mergeUserMessages(threadReadToMessages(thread), eventMessages) : threadReadToMessages(thread);
      const currentMessages = activeThread(workspacesRef.current, threadId)?.messages ?? target.messages;
      const messages = mergeLoadedMessagesWithCurrent(applyRunningTaskToMessages(loadedMessages, runningTask), currentMessages);
      updateThread(cwd, threadId, {
        messages,
        needsResume: true,
        isLoadingHistory: false,
        title: target.title === "未命名对话" && messages[0]?.text ? titleFromMessage(messages[0].text) : target.title
      });
    } catch {
      updateThread(cwd, threadId, { isLoadingHistory: false });
    }
  }

  function updateThread(cwd: string, threadId: string, patch: Partial<UiWorkspace["threads"][number]>) {
    updateThreadState(setWorkspaces, cwd, (threads) => threads.map((thread) => (
      thread.id === threadId ? { ...thread, ...patch } : thread
    )));
  }

  function markThreadResumed(cwd: string, threadId: string) {
    updateThread(cwd, threadId, { needsResume: false });
  }

  function markThreadGenerating(threadId: string, turnId = `pending-${threadId}`, startedAtMs = Date.now()) {
    const now = new Date(startedAtMs).toISOString();
    setLocalRunningTurns((current) => ({
      ...current,
      [threadId]: {
        threadId,
        turnId,
        status: "running",
        kind: current[threadId]?.kind ?? "normal",
        startedAt: current[threadId]?.startedAt ?? now,
        lastEventAt: now,
        lastSeq: current[threadId]?.lastSeq ?? 0,
        eventCount: current[threadId]?.eventCount ?? 0
      }
    }));
    markThreadActivityRunning(threadId);
  }

  function appendOptimisticTurn(threadId: string, turnId: string, text: string, attachments: UploadedAttachment[]) {
    const startedAt = Date.now();
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId
        ? {
            ...thread,
            messages: appendOptimisticTurnMessages(thread.messages, {
              turnId,
              text,
              attachments,
              startedAt
            })
          }
        : thread)
    })));
  }

  function markThreadActivityRunning(threadId: string) {
    activityStartedThreadIdsRef.current.add(threadId);
    setThreadActivityIndicators((current) => {
      if (current[threadId] === "running") return current;
      return { ...current, [threadId]: "running" };
    });
  }

  function markThreadActivityFinished(threadId: string, status: Exclude<UiThreadActivityIndicator, "running">) {
    if (activeThreadIdRef.current === threadId) {
      clearThreadActivityIndicator(threadId);
      return;
    }
    if (!activityStartedThreadIdsRef.current.has(threadId)) return;
    setThreadActivityIndicators((current) => {
      if (current[threadId] !== "running") return current;
      return { ...current, [threadId]: status };
    });
  }

  function clearThreadActivityIndicator(threadId: string) {
    setThreadActivityIndicators((current) => {
      if (!(threadId in current)) return current;
      const next = { ...current };
      delete next[threadId];
      activityStartedThreadIdsRef.current.delete(threadId);
      return next;
    });
  }

  function markThreadFinished(
    threadId: string,
    timing?: { turnId?: string; startedAt?: number; completedAt?: number; durationMs?: number },
    statusLine?: { text: string; tone: UiMessage["statusTone"] }
  ) {
    setLocalRunningTurns((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    setQueuedSteers((current) => {
      if (!current[threadId]?.length) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId
        ? {
            ...thread,
            messages: thread.messages.map((message) => (
              message.role === "assistant" && (!timing?.turnId || message.turnId === timing.turnId || message.id === assistantTurnMessageId(timing.turnId))
                ? {
                    ...message,
                    isStreaming: false,
                    turnStartedAt: timing?.startedAt ?? message.turnStartedAt,
                    turnCompletedAt: timing?.completedAt ?? Date.now(),
                    turnDurationMs: timing?.durationMs ?? durationFromTiming(timing?.startedAt ?? message.turnStartedAt, timing?.completedAt),
                    statusText: statusLine?.text ?? message.statusText,
                    statusTone: statusLine?.tone ?? message.statusTone
                  }
                : { ...message, isStreaming: false }
            )).filter((message) => message.role !== "assistant" || message.text.trim() || message.assistantParts?.length || message.statusText || message.id.startsWith("pending-assistant-"))
          }
        : thread)
    })));
  }

  function finishPendingAssistant(threadId: string, text: string, statusText?: string, statusTone?: UiMessage["statusTone"]) {
    setWorkspaces((current) => current.map((workspace) => ({
      ...workspace,
      threads: workspace.threads.map((thread) => thread.id === threadId
        ? {
            ...thread,
            messages: thread.messages.map((message) => message.id === pendingAssistantId(threadId)
              ? { ...message, text: text || message.text, statusText, statusTone, isStreaming: false }
              : { ...message, isStreaming: false })
              .filter((message) => message.id !== pendingAssistantId(threadId) || message.text.trim() || message.assistantParts?.length || message.statusText)
          }
        : thread)
    })));
  }

  const selectedThread = activeThread(workspaces, activeThreadId);
  const effectiveCwd = activeCwd ?? selectedThread?.cwd;
  const selectedWorkspace = workspaces.find((workspace) => workspace.cwd === effectiveCwd);
  const runningTasks = allRunningTasks(tasks, localRunningTurns);
  const selectedIsGenerating = Boolean(runningTaskFor(activeThreadId, runningTasks));
  const selectedRunningTask = activeThreadId ? runningTaskFor(activeThreadId, runningTasks) : undefined;
  const selectedQueuedSteers = useMemo(() => activeThreadId ? [
    ...(queuedSteers[activeThreadId] ?? []),
    ...(pendingCompactMessages[activeThreadId] ?? []).map((item) => ({
      id: item.id,
      text: item.text || `${item.attachments.length} 个附件`,
      status: "queued" as const
    }))
  ] : [], [activeThreadId, queuedSteers, pendingCompactMessages]);
  const rollbackToMessageRef = useRef(rollbackToMessage);
  const forkFromMessageRef = useRef(forkFromMessage);
  useEffect(() => {
    rollbackToMessageRef.current = rollbackToMessage;
    forkFromMessageRef.current = forkFromMessage;
  });
  const handleRemoveQueuedSteer = useCallback((id: string) => {
    const threadId = activeThreadIdRef.current;
    if (threadId) removeQueuedSteer(threadId, id);
  }, []);
  const handleRollbackMessage = useCallback((messageId: string) => {
    void rollbackToMessageRef.current(messageId);
  }, []);
  const handleForkMessage = useCallback((messageId: string) => {
    void forkFromMessageRef.current(messageId);
  }, []);
  const handleRequestCollapseMobileJumpRail = useCallback(() => {
    setMobileJumpRailOpen(false);
  }, []);
  const isDraft = !selectedThread || selectedThread.isDraft;
  const isDraftTransitioning = Boolean(draftTransition && selectedThread && draftTransition.threadId === selectedThread.id && !isDraft);
  const visibleThreadActivityIndicators = Object.fromEntries(
    Object.entries(threadActivityIndicators).filter(([threadId, indicator]) => indicator === "running" || activityStartedThreadIdsRef.current.has(threadId))
  );

  if (!authStatus.loaded) {
    return (
      <main className="login-screen">
        <section className="login-panel login-panel-loading">
          <div className="login-mark">
            <span>Codex Web</span>
          </div>
          <p>正在检查访问状态...</p>
        </section>
      </main>
    );
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return (
      <LoginScreen
        loading={authLoading}
        error={authError}
        savedPasswordEnabled={savedPasswordEnabled}
        onLogin={login}
      />
    );
  }

  return (
    <div className={`${isDraftTransitioning ? "app-shell draft-transitioning" : "app-shell"} ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {!sidebarCollapsed ? (
        <button className="mobile-sidebar-scrim" type="button" aria-label="收起侧边栏" onClick={() => setSidebarCollapsed(true)} />
      ) : null}
      <Sidebar
        workspaces={workspaces}
        loadError={workspaceLoadError}
        activeCwd={activeCwd}
        activeThreadId={activeThreadId}
        threadActivityIndicators={visibleThreadActivityIndicators}
        onSelectWorkspace={(cwd) => {
          setActiveCwd(cwd);
          setActiveThreadId(null);
          activeThreadIdRef.current = null;
        }}
        onSelectThread={(threadId, cwd) => void selectThread(threadId, cwd)}
        onAddWorkspace={(cwd) => void addWorkspace(cwd)}
        onQuickCreateWorkspace={() => void quickCreateWorkspace()}
        onNewThread={(cwd) => createThread(cwd ?? activeCwd)}
        onRenameProject={(cwd, name) => void updateProjects(api.renameProject(cwd, name))}
        onPinProject={(cwd) => void updateProjects(api.pinProject(cwd))}
        onMoveProject={(cwd, direction) => void updateProjects(api.moveProject(cwd, direction))}
        onDeleteProject={(cwd) => {
          void updateProjects(api.deleteProject(cwd));
          if (cwd === activeCwd) {
            setActiveCwd(undefined);
            setActiveThreadId(null);
            activeThreadIdRef.current = null;
          }
        }}
        onRestoreProject={restoreProject}
        onPinThread={pinThread}
        onRegenerateThreadTitle={regenerateThreadTitle}
        onRenameThread={renameThread}
        onExportThread={exportThread}
        onDeleteThread={deleteThread}
        onRestoreThread={restoreThread}
        onMoveThread={moveThread}
        colorMode={colorMode}
        themes={themes}
        activeThemeId={activeThemeId}
        onToggleColorMode={() => setColorMode((current) => current === "dark" ? "light" : "dark")}
        onSelectTheme={setActiveThemeId}
        onCreateTheme={async (name, css) => {
          const nextThemes = await api.createTheme(name, css);
          setThemes(nextThemes);
          const created = nextThemes.find((theme) => theme.source === "custom" && theme.name.toLowerCase() === name.trim().toLowerCase())
            ?? nextThemes.find((theme) => theme.source === "custom" && theme.id.includes(name.trim().toLowerCase().replace(/\s+/g, "-")));
          if (created) setActiveThemeId(created.id);
        }}
        onDeleteTheme={async (id) => {
          const nextThemes = await api.deleteTheme(id);
          setThemes(nextThemes);
          if (id === activeThemeId) setActiveThemeId("default");
        }}
        toolGroupCollapseMode={toolGroupCollapseMode}
        onToolGroupCollapseModeChange={setToolGroupCollapseMode}
        approvalDetailsCollapsedByDefault={approvalDetailsCollapsedByDefault}
        onToggleApprovalDetailsCollapsedByDefault={() => setApprovalDetailsCollapsedByDefault((current) => !current)}
        renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
        onToggleRenderUserMessagesAsMarkdown={() => setRenderUserMessagesAsMarkdown((current) => !current)}
        desktopSendBehavior={desktopSendBehavior}
        mobileSendBehavior={mobileSendBehavior}
        activeSendBehaviorDevice={isMobileLayout ? "mobile" : "desktop"}
        onDesktopSendBehaviorChange={setDesktopSendBehavior}
        onMobileSendBehaviorChange={setMobileSendBehavior}
        historyCacheTurnLimit={historyCacheTurnLimit}
        onHistoryCacheTurnLimitChange={setHistoryCacheTurnLimit}
        sidebarWidth={sidebarWidth}
        onSidebarWidthChange={setSidebarWidth}
        defaultModel={model}
        defaultWorkMode={workMode}
        defaultEffort={effort}
        onDefaultModelChange={setModel}
        onDefaultWorkModeChange={setWorkMode}
        onDefaultEffortChange={setEffort}
        authEnabled={authStatus.enabled}
        authenticated={authStatus.authenticated}
        savedPasswordEnabled={savedPasswordEnabled}
        onAuthSettingsChange={() => void refreshAuthStatus()}
        onClearSavedPassword={clearSavedPassword}
        onLogout={() => void logout()}
      />
      <section className="workspace">
        <StatusBar
          title={selectedThread?.title ?? "新对话"}
          status={status}
          tasks={tasks}
          capabilities={capabilities}
          onRefresh={() => void refreshCurrentView()}
          onRefreshCapabilities={() => void refreshCapabilities()}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((current) => !current)}
          isMobileLayout={isMobileLayout}
          mobileJumpRailOpen={mobileJumpRailOpen}
          onToggleMobileJumpRail={() => setMobileJumpRailOpen((current) => !current)}
        />
        {isDraft ? (
          <main className="draft-stage">
            <h2>告诉 Codex 需要构建什么？</h2>
            {composer({
              disabled: !effectiveCwd,
              isDraft,
              selectedWorkspace,
              workspaces,
              activeCwd: effectiveCwd,
              workMode,
              model,
              effort,
              composerText,
              composerAttachments,
              commandMode,
              sendBehavior: effectiveSendBehavior(isMobileLayout, desktopSendBehavior, mobileSendBehavior),
              setActiveCwd,
              createThread,
              setWorkMode,
              setModel,
              setEffort,
              setComposerText,
              setComposerAttachments,
              onCommandModeChange: setCommandMode,
              onRunCompact: () => void runCompact(),
              onRunInit: () => void runInit(),
              sendMessage,
              isGenerating: selectedIsGenerating,
              stopGeneration: () => void stopGeneration(activeThreadId),
              capabilities,
              toggleSkill,
              togglePlugin
            })}
          </main>
        ) : (
          <>
            {isDraftTransitioning ? (
              <div className="draft-transition-ghost" aria-hidden="true">
                <h2>告诉 Codex 需要构建什么？</h2>
                <div className="draft-transition-project">
                  <span>{draftTransition?.projectName ?? selectedWorkspace?.name ?? "选择项目"}</span>
                </div>
              </div>
            ) : null}
            <ChatPane
              thread={selectedThread}
              isGenerating={selectedIsGenerating}
              model={model}
              toolGroupCollapseMode={toolGroupCollapseMode}
              renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
              historyCacheTurnLimit={historyCacheTurnLimit}
              queuedSteers={selectedQueuedSteers}
              runningTask={selectedRunningTask}
              onRemoveQueuedSteer={handleRemoveQueuedSteer}
              onRollbackMessage={handleRollbackMessage}
              onForkMessage={handleForkMessage}
              isMobileLayout={isMobileLayout}
              mobileJumpRailOpen={mobileJumpRailOpen}
              onRequestCollapseMobileJumpRail={handleRequestCollapseMobileJumpRail}
            />
            <ApprovalStack
              approvals={pendingApprovals}
              detailsCollapsedByDefault={approvalDetailsCollapsedByDefault}
              onApprove={async (id) => {
                await api.approve(id);
                await refreshApprovals();
              }}
              onReject={async (id) => {
                await api.reject(id, "Rejected by user");
                await refreshApprovals();
              }}
              onAlwaysAllow={async (id) => {
                await api.approve(id, { decision: "accept", acceptSettings: { forSession: true } });
                await refreshApprovals();
              }}
            />
            {composer({
              disabled: !effectiveCwd,
              isDraft,
              selectedWorkspace,
              workspaces,
              activeCwd: effectiveCwd,
              workMode,
              model,
              effort,
              composerText,
              composerAttachments,
              commandMode,
              sendBehavior: effectiveSendBehavior(isMobileLayout, desktopSendBehavior, mobileSendBehavior),
              setActiveCwd,
              createThread,
              setWorkMode,
              setModel,
              setEffort,
              setComposerText,
              setComposerAttachments,
              onCommandModeChange: setCommandMode,
              onRunCompact: () => void runCompact(),
              onRunInit: () => void runInit(),
              sendMessage,
              isGenerating: selectedIsGenerating,
              stopGeneration: () => void stopGeneration(activeThreadId),
              capabilities,
              toggleSkill,
              togglePlugin
            })}
          </>
        )}
      </section>
    </div>
  );
}

function mergeUserMessages(threadMessages: UiMessage[], eventMessages: UiMessage[]): UiMessage[] {
  if (!threadMessages.length) return eventMessages;
  if (!eventMessages.length) return threadMessages;

  const eventMessagesByTurn = new Map<string, UiMessage[]>();
  for (const eventMessage of eventMessages) {
    if (eventMessage.turnId) {
      eventMessagesByTurn.set(eventMessage.turnId, [...(eventMessagesByTurn.get(eventMessage.turnId) ?? []), eventMessage]);
    }
  }

  const usedTurns = new Set<string>();
  const result: UiMessage[] = [];
  for (const threadMessage of threadMessages) {
    if (threadMessage.role === "assistant" && threadMessage.turnId && eventMessagesByTurn.has(threadMessage.turnId)) {
      result.push(...(eventMessagesByTurn.get(threadMessage.turnId) ?? []));
      usedTurns.add(threadMessage.turnId);
      continue;
    }
    result.push(threadMessage);
  }

  return result;
}

function applyRunningTaskToMessages(messages: UiMessage[], task: TaskSummary | undefined): UiMessage[] {
  if (!task || task.status !== "running") return messages;
  const startedAt = parseIsoTimestamp(task.startedAt);
  const assistantId = assistantTurnMessageId(task.turnId);
  let found = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant" || (message.turnId !== task.turnId && message.id !== assistantId)) return message;
    found = true;
    return {
      ...message,
      id: assistantId,
      turnId: task.turnId,
      isStreaming: true,
      turnStartedAt: startedAt ?? message.turnStartedAt ?? message.createdAt,
      turnCompletedAt: undefined,
      turnDurationMs: undefined
    };
  });
  if (found) return next;
  return [...next, {
    id: assistantId,
    role: "assistant",
    turnId: task.turnId,
    text: "",
    createdAt: startedAt ?? undefined,
    turnStartedAt: startedAt ?? undefined,
    isStreaming: true
  }];
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textFromUserItem(item: Record<string, unknown>): string {
  const direct = firstString(item.text, item.message, item.content);
  if (direct) return direct;
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .map((part) => firstString((part as Record<string, unknown>)?.text, (part as Record<string, unknown>)?.message))
    .filter(Boolean)
    .join("\n");
}

function upsertAssistantToolPart(current: UiAssistantPart[] | undefined, toolCall: UiToolCall): UiAssistantPart[] {
  const parts = current ?? [];
  if (!parts.some((part) => part.type === "tool" && part.id === toolCall.id)) {
    return [...parts, { type: "tool", id: toolCall.id, toolCall }];
  }
  return parts.map((part) => part.type === "tool" && part.id === toolCall.id ? { ...part, toolCall } : part);
}

function updateAssistantToolPart(current: UiAssistantPart[] | undefined, itemId: string, updater: (toolCall: UiToolCall) => UiToolCall): UiAssistantPart[] {
  const parts = current ?? [];
  if (!parts.some((part) => part.type === "tool" && part.id === itemId)) {
    return [...parts, {
      type: "tool",
      id: itemId,
      toolCall: updater({
        id: itemId,
        type: "fileChange",
        command: "",
        title: "修改文件",
        status: "inProgress"
      })
    }];
  }
  return parts.map((part) => part.type === "tool" && part.id === itemId ? { ...part, toolCall: updater(part.toolCall) } : part);
}

function upsertSteerList(current: QueuedSteerMessage[] | undefined, steer: QueuedSteerMessage): QueuedSteerMessage[] {
  const existing = current ?? [];
  if (!existing.some((item) => item.id === steer.id || item.text === steer.text)) return [...existing, steer];
  return existing.map((item) => item.id === steer.id || item.text === steer.text ? { ...item, ...steer } : item);
}

function removeSteerFromList(current: QueuedSteerMessage[] | undefined, steerId: string): QueuedSteerMessage[] {
  return (current ?? []).filter((item) => item.id !== steerId);
}

function upsertAssistantSteerPart(current: UiAssistantPart[] | undefined, steer: QueuedSteerMessage): UiAssistantPart[] {
  const parts = current ?? [];
  if (!parts.some((part) => part.type === "steer" && (part.id === steer.id || part.text === steer.text))) {
    return [...parts, { type: "steer", id: steer.id, text: steer.text, status: steer.status }];
  }
  return parts.map((part) => part.type === "steer" && (part.id === steer.id || part.text === steer.text)
    ? { type: "steer", id: part.id, text: steer.text, status: steer.status }
    : part);
}

function removeAssistantSteerPart(current: UiAssistantPart[] | undefined, steerId: string): UiAssistantPart[] | undefined {
  if (!current) return current;
  return current.filter((part) => part.type !== "steer" || part.id !== steerId);
}

function withAssistantTurnMessage(
  thread: UiWorkspace["threads"][number],
  turnId: string | undefined,
  updater: (message: UiMessage) => UiMessage
): UiMessage[] {
  const targetId = turnId ? assistantTurnMessageId(turnId) : pendingAssistantId(thread.id);
  const pendingId = pendingAssistantId(thread.id);
  const existingIndex = thread.messages.findIndex((message) => (
    message.role === "assistant" && (message.id === targetId || (Boolean(turnId) && message.turnId === turnId) || (!turnId && message.id === pendingId))
  ));
  if (existingIndex >= 0) {
    return thread.messages.map((message, index) => index === existingIndex
      ? updater({ ...message, id: targetId, turnId: turnId ?? message.turnId })
      : message);
  }
  return [...thread.messages.filter((message) => message.id !== pendingId), updater({
    id: targetId,
    role: "assistant",
    turnId,
    text: "",
    createdAt: Date.now(),
    isStreaming: true
  })];
}

function appendAssistantTextPartDelta(message: UiMessage, partId: string, delta: string): UiMessage {
  const parts = ensureTextPart(message.assistantParts, partId)
    .map((part) => part.type === "text" && part.id === partId ? { ...part, text: part.text + delta } : part);
  return { ...message, text: joinAssistantText(parts), assistantParts: parts, isStreaming: true };
}

function replaceAssistantTextPart(message: UiMessage, partId: string, text: string): UiMessage {
  const parts = upsertTextPart(message.assistantParts, { type: "text", id: partId, text });
  return { ...message, text: joinAssistantText(parts), assistantParts: parts };
}

function upsertTextPart(current: UiAssistantPart[] | undefined, nextPart: Extract<UiAssistantPart, { type: "text" }>): UiAssistantPart[] {
  const existing = current ?? [];
  if (!existing.some((part) => part.type === "text" && part.id === nextPart.id)) return [...existing, nextPart];
  return existing.map((part) => part.type === "text" && part.id === nextPart.id ? nextPart : part);
}

function appendAssistantReasoningPartDelta(current: UiAssistantPart[] | undefined, partId: string, delta: string): UiAssistantPart[] {
  const existing = current ?? [];
  if (!existing.some((part) => part.type === "reasoning" && part.id === partId)) {
    return [...existing, { type: "reasoning", id: partId, text: delta, summary: true }];
  }
  return existing.map((part) => part.type === "reasoning" && part.id === partId ? { ...part, text: `${part.text}${delta}` } : part);
}

function upsertAssistantReasoningPart(current: UiAssistantPart[] | undefined, partId: string, text: string): UiAssistantPart[] {
  const existing = current ?? [];
  if (!existing.some((part) => part.type === "reasoning" && part.id === partId)) {
    return [...existing, { type: "reasoning", id: partId, text, summary: true }];
  }
  return existing.map((part) => part.type === "reasoning" && part.id === partId ? { ...part, text } : part);
}

function ensureTextPart(current: UiAssistantPart[] | undefined, partId: string): UiAssistantPart[] {
  const existing = current ?? [];
  if (existing.some((part) => part.type === "text" && part.id === partId)) return existing;
  return [...existing, { type: "text", id: partId, text: "" }];
}

function joinAssistantText(parts: UiAssistantPart[]): string {
  return parts
    .filter((part): part is Extract<UiAssistantPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function updateThreadState(
  setWorkspaces: (value: SetStateAction<UiWorkspace[]>) => void,
  cwd: string,
  updater: (threads: UiWorkspace["threads"]) => UiWorkspace["threads"]
) {
  setWorkspaces((current) => current.map((workspace) => (
    workspace.cwd === cwd ? { ...workspace, threads: updater(workspace.threads) } : workspace
  )));
}

function safeFileName(input: string): string {
  const normalized = input.trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
  return normalized || "conversation";
}

function safeJson(input: unknown): any | null {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function updateSkillCapability(capabilities: CapabilityPayload | null, path: string, enabled: boolean): CapabilityPayload | null {
  if (!capabilities?.skills?.data) return capabilities;
  return {
    ...capabilities,
    skills: {
      ...capabilities.skills,
      data: capabilities.skills.data.map((entry) => ({
        ...entry,
        skills: entry.skills.map((skill) => skill.path === path ? { ...skill, enabled } : skill)
      }))
    }
  };
}

function updatePluginCapability(capabilities: CapabilityPayload | null, pluginId: string, enabled: boolean): CapabilityPayload | null {
  if (!capabilities?.plugins?.marketplaces) return capabilities;
  return {
    ...capabilities,
    plugins: {
      ...capabilities.plugins,
      marketplaces: capabilities.plugins.marketplaces.map((marketplace) => ({
        ...marketplace,
        plugins: marketplace.plugins.map((plugin) => plugin.id === pluginId ? { ...plugin, enabled } : plugin)
      }))
    }
  };
}

function threadOverridesFor(workMode: WorkMode, model: string): Record<string, unknown> {
  return compact({
    model: model || undefined,
    approvalsReviewer: workMode === "auto-review" ? "auto_review" : undefined,
    approvalPolicy: workMode === "yolo" ? "never" : undefined,
    sandbox: workMode === "full-access" || workMode === "yolo" ? "danger-full-access" : undefined
  });
}

function turnOverridesFor(workMode: WorkMode, model: string, effort: ReasoningEffort, commandMode: ComposerCommandMode | null = null): Record<string, unknown> {
  return compact({
    model: model || undefined,
    effort: commandMode === "plan" ? "medium" : effort,
    collaborationMode: commandMode === "plan"
      ? {
          mode: "plan",
          settings: {
            model: model || "gpt-5",
            reasoning_effort: "medium",
            developer_instructions: null
          }
        }
      : undefined,
    approvalsReviewer: workMode === "auto-review" ? "auto_review" : undefined,
    approvalPolicy: workMode === "yolo" ? "never" : undefined,
    sandboxPolicy: workMode === "full-access" || workMode === "yolo" ? { type: "dangerFullAccess" } : undefined
  });
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function projectToWorkspace(project: { cwd: string; name: string; updatedAt: number; pinned?: boolean }): UiWorkspace {
  return {
    cwd: project.cwd,
    name: project.name,
    updatedAt: project.updatedAt,
    pinned: project.pinned,
    runningCount: 0,
    threads: []
  };
}

function mergeProjectRecords(projects: Array<{ cwd: string; name: string; updatedAt: number; pinned?: boolean }>, current: UiWorkspace[]): UiWorkspace[] {
  return projects.map((project) => {
    const existing = current.find((workspace) => workspace.cwd === project.cwd);
    return {
      ...projectToWorkspace(project),
      runningCount: existing?.runningCount ?? 0,
      threads: existing?.threads ?? []
    };
  });
}

function mergeThreadsIntoProjects(projects: Array<{ cwd: string; name: string; updatedAt: number; pinned?: boolean }>, threads: ThreadSummary[], current: UiWorkspace[] = []): UiWorkspace[] {
  return projects.map((project) => {
    const existing = current.find((workspace) => workspace.cwd === project.cwd);
    const projectThreads = sortUiThreads(threads
      .filter((thread) => thread.cwd === project.cwd)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((thread) => {
        const existingThread = existing?.threads.find((item) => item.id === thread.id);
        return {
          id: thread.id,
          cwd: thread.cwd,
          title: existingThread?.title ?? thread.name ?? thread.preview ?? "未命名对话",
          updatedAt: thread.updatedAt,
          pinned: thread.pinned ?? existingThread?.pinned,
          order: typeof thread.order === "number" ? thread.order : existingThread?.order,
          status: normalizeThreadStatus(thread.status ?? existingThread?.status),
          isDraft: false,
          needsResume: existingThread?.needsResume ?? true,
          isLoadingHistory: existingThread?.isLoadingHistory ?? false,
          messages: existingThread?.messages ?? []
        };
      }));
    const localDrafts = sortUiThreads((existing?.threads ?? []).filter((thread) => thread.isDraft && !projectThreads.some((item) => item.id === thread.id)));
    return {
      ...projectToWorkspace(project),
      runningCount: projectThreads.filter((thread) => threads.find((item) => item.id === thread.id)?.status === "running").length,
      threads: sortUiThreads([...localDrafts, ...projectThreads])
    };
  });
}

function upsertPendingThreadShell(workspaces: UiWorkspace[], shell: PendingThreadShell): UiWorkspace[] {
  return workspaces.map((workspace) => {
    if (workspace.cwd !== shell.cwd) return workspace;
    const nextThread: UiWorkspace["threads"][number] = {
      id: shell.id,
      cwd: shell.cwd,
      title: shell.title,
      updatedAt: shell.updatedAt,
      pinned: false,
      status: "completed",
      isDraft: false,
      needsResume: true,
      isLoadingHistory: false,
      messages: []
    };
    const filtered = workspace.threads.filter((thread) => thread.id !== shell.id && !thread.isDraft);
    return {
      ...workspace,
      updatedAt: Math.max(workspace.updatedAt, shell.updatedAt),
      threads: sortUiThreads([nextThread, ...filtered])
    };
  });
}

function sortUiThreads(threads: UiThread[]): UiThread[] {
  return [...threads].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const orderA = typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
    const orderB = typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    return b.updatedAt - a.updatedAt;
  });
}

function reorderThreadsForDrop(threads: UiThread[], threadId: string, targetThreadId: string, placement: "before" | "after"): UiThread[] | null {
  const from = threads.findIndex((thread) => thread.id === threadId);
  const to = threads.findIndex((thread) => thread.id === targetThreadId);
  if (from < 0 || to < 0 || from === to) return null;
  if (Boolean(threads[from]?.pinned) !== Boolean(threads[to]?.pinned)) return null;
  const next = [...threads];
  const [moved] = next.splice(from, 1);
  if (!moved) return null;
  const targetIndex = next.findIndex((thread) => thread.id === targetThreadId);
  if (targetIndex < 0) return null;
  next.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved);
  return next.map((thread, index) => ({ ...thread, order: index }));
}

function normalizeThreadStatus(status: unknown): UiThread["status"] {
  if (status === "running") return "running";
  if (status === "failed") return "failed";
  return "completed";
}

function composer(input: {
  disabled: boolean;
  isDraft: boolean;
  selectedWorkspace?: UiWorkspace;
  workspaces: UiWorkspace[];
  activeCwd?: string;
  workMode: WorkMode;
  model: string;
  effort: ReasoningEffort;
  composerText: string;
  composerAttachments: UploadedAttachment[];
  commandMode: ComposerCommandMode | null;
  sendBehavior: SendBehavior;
  setActiveCwd: (cwd: string) => void;
  createThread: (cwd?: string) => void;
  setWorkMode: (mode: WorkMode) => void;
  setModel: (model: string) => void;
  setEffort: (effort: ReasoningEffort) => void;
  setComposerText: (text: string) => void;
  setComposerAttachments: (attachments: UploadedAttachment[]) => void;
  onCommandModeChange: (mode: ComposerCommandMode | null) => void;
  onRunCompact: () => void;
  onRunInit: () => void;
  sendMessage: (text: string, attachments: UploadedAttachment[]) => Promise<void>;
  isGenerating?: boolean;
  stopGeneration?: () => void;
  capabilities: CapabilityPayload | null;
  toggleSkill: (path: string, enabled: boolean) => Promise<void>;
  togglePlugin: (pluginId: string, enabled: boolean) => Promise<void>;
}) {
  return (
    <Composer
      disabled={input.disabled}
      isDraft={input.isDraft}
      projectName={input.selectedWorkspace?.name}
      projectPath={input.selectedWorkspace?.cwd}
      projects={input.workspaces.map((workspace) => ({ cwd: workspace.cwd, name: workspace.name }))}
      activeCwd={input.activeCwd}
      workMode={input.workMode}
      model={input.model}
      effort={input.effort}
      text={input.composerText}
      attachments={input.composerAttachments}
      commandMode={input.commandMode}
      sendBehavior={input.sendBehavior}
      onTextChange={input.setComposerText}
      onAttachmentsChange={input.setComposerAttachments}
      onCommandModeChange={input.onCommandModeChange}
      onRunCompact={input.onRunCompact}
      onRunInit={input.onRunInit}
      isGenerating={input.isGenerating}
      onSelectProject={(cwd) => {
        input.setActiveCwd(cwd);
        input.createThread(cwd);
      }}
      onSelectWorkMode={input.setWorkMode}
      onSelectModel={input.setModel}
      onSelectEffort={input.setEffort}
      onSend={(text, images) => input.sendMessage(text, images)}
      onStop={input.stopGeneration}
      capabilities={input.capabilities}
      onToggleSkill={(path, enabled) => void input.toggleSkill(path, enabled)}
      onTogglePlugin={(pluginId, enabled) => void input.togglePlugin(pluginId, enabled)}
    />
  );
}

function activeThread(workspaces: UiWorkspace[], threadId: string | null) {
  if (!threadId) return null;
  for (const workspace of workspaces) {
    const thread = workspace.threads.find((item) => item.id === threadId);
    if (thread) return thread;
  }
  return null;
}

function titleFromMessage(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= 28) return normalized || "新对话";
  return `${normalized.slice(0, 28)}...`;
}

function generatedTitleFrom(input: unknown): string | undefined {
  if (typeof input === "string" && input.trim()) return input.trim();
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  return firstString(record.title, record.name, record.summary, record.text);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function textWithFilePaths(text: string, files: Extract<UploadedAttachment, { kind: "file" }>[]): string {
  const base = text.trim();
  if (!files.length) return base;
  const lines = files.map((file) => `- ${file.name}: ${file.path}`);
  const fileText = ["", "用户上传了以下本地临时文件，请按需读取或处理：", ...lines].join("\n");
  return `${base}${fileText}`.trim();
}

function pendingAssistantId(threadId: string): string {
  return `pending-assistant-${threadId}`;
}

function assistantTurnMessageId(turnId: string): string {
  return `assistant-turn-${turnId}`;
}

function parseEventCreatedAt(event: BridgeEventLike | undefined): number | undefined {
  if (!event?.createdAt) return undefined;
  const timestamp = Date.parse(event.createdAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function allRunningTasks(tasks: TaskSummary[], localRunningTurns: Record<string, TaskSummary>): TaskSummary[] {
  const byThread = new Map<string, TaskSummary>();
  for (const task of tasks.filter((item) => item.status === "running")) byThread.set(task.threadId, task);
  for (const task of Object.values(localRunningTurns)) byThread.set(task.threadId, task);
  return [...byThread.values()];
}

function onlyRunningTasks(tasks: TaskSummary[]): TaskSummary[] {
  return tasks.filter((task) => task.status === "running");
}

function runningTaskFor(threadId: string | null, tasks: TaskSummary[]): TaskSummary | undefined {
  if (!threadId) return undefined;
  return tasks.find((task) => task.threadId === threadId && task.status === "running");
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function currentPreferences(input: {
  colorMode: "light" | "dark";
  activeThemeId: string;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  approvalDetailsCollapsedByDefault: boolean;
  renderUserMessagesAsMarkdown: boolean;
  desktopSendBehavior: SendBehavior;
  mobileSendBehavior: SendBehavior;
  historyCacheTurnLimit: number;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  model: string;
  workMode: WorkMode;
  effort: ReasoningEffort;
}): UserPreferences {
  return {
    colorMode: input.colorMode,
    activeThemeId: input.activeThemeId,
    collapseToolGroupsByDefault: input.toolGroupCollapseMode === "alwaysCollapsed",
    toolGroupCollapseMode: input.toolGroupCollapseMode,
    approvalDetailsCollapsedByDefault: input.approvalDetailsCollapsedByDefault,
    renderUserMessagesAsMarkdown: input.renderUserMessagesAsMarkdown,
    sendBehavior: input.desktopSendBehavior,
    desktopSendBehavior: input.desktopSendBehavior,
    mobileSendBehavior: input.mobileSendBehavior,
    historyCacheTurnLimit: clampNumber(input.historyCacheTurnLimit, MIN_HISTORY_CACHE_TURNS, MAX_HISTORY_CACHE_TURNS, DEFAULT_HISTORY_CACHE_TURNS),
    sidebarWidth: clampNumber(input.sidebarWidth, 240, 520, 286),
    sidebarCollapsed: input.sidebarCollapsed,
    defaultModel: input.model || undefined,
    defaultWorkMode: input.workMode,
    defaultEffort: input.effort
  };
}

function normalizeSendBehavior(value: unknown, fallback: SendBehavior): SendBehavior {
  if (value === "shiftEnter" || value === "modEnter") return "shiftEnter";
  if (value === "enter") return "enter";
  return fallback;
}

function effectiveSendBehavior(isMobileLayout: boolean, desktop: SendBehavior, mobile: SendBehavior): SendBehavior {
  return isMobileLayout ? mobile : desktop;
}

function isMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches;
}

function hasSavedPassword(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(SAVED_PASSWORD_KEY));
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function readSavedPassword(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SAVED_PASSWORD_KEY);
}

function readStoredActiveSelection(): { cwd?: string; threadId?: string } {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(ACTIVE_SELECTION_KEY) ?? "null") as { cwd?: unknown; threadId?: unknown } | null;
    return {
      cwd: typeof parsed?.cwd === "string" && parsed.cwd ? parsed.cwd : undefined,
      threadId: typeof parsed?.threadId === "string" && parsed.threadId ? parsed.threadId : undefined
    };
  } catch {
    return {};
  }
}

function writeStoredActiveSelection(cwd: string | undefined, threadId: string | null) {
  if (typeof window === "undefined") return;
  if (!cwd && !threadId) {
    window.localStorage.removeItem(ACTIVE_SELECTION_KEY);
    return;
  }
  window.localStorage.setItem(ACTIVE_SELECTION_KEY, JSON.stringify({ cwd, threadId: threadId ?? undefined }));
}

function isWorkMode(value: unknown): value is WorkMode {
  return value === "default" || value === "auto-review" || value === "full-access" || value === "yolo";
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function workModeFromSettings(settings: Record<string, unknown>): WorkMode | undefined {
  const approvalPolicy = settings.approvalPolicy;
  const approvalsReviewer = settings.approvalsReviewer;
  const sandboxPolicy = settings.sandboxPolicy;
  const sandboxType = typeof sandboxPolicy === "string"
    ? sandboxPolicy
    : readPath<string>(sandboxPolicy, ["type"]);
  if (approvalPolicy === "never") return "yolo";
  if (approvalsReviewer === "auto_review") return "auto-review";
  if (sandboxType === "dangerFullAccess" || sandboxType === "danger-full-access") return "full-access";
  return "default";
}

function eventThreadStatus(event: BridgeEventLike): "completed" | "failed" | "interrupted" | undefined {
  const status = readPath<string>(event, ["payload", "status"]) ?? readPath<string>(event, ["payload", "params", "turn", "status"]);
  if (status === "completed" || status === "failed" || status === "interrupted") return status;
  return undefined;
}

function turnStatusLine(status: "completed" | "failed" | "interrupted" | undefined, event: BridgeEventLike): { text: string; tone: UiMessage["statusTone"] } | undefined {
  if (status === "interrupted") return { text: "已停止生成", tone: "danger" };
  if (status === "failed") {
    const reason = readPath<string>(event, ["payload", "error", "message"])
      ?? readPath<string>(event, ["payload", "error", "detail"])
      ?? readPath<string>(event, ["payload", "message"]);
    return { text: reason || "生成失败", tone: "danger" };
  }
  return undefined;
}

function turnsFromUserMessage(messages: UiMessage[], userMessageId: string): number {
  const userMessages = messages.filter((message) => message.role === "user");
  const index = userMessages.findIndex((message) => message.id === userMessageId);
  if (index < 0) return 0;
  return userMessages.length - index;
}

function turnsAfterMessage(messages: UiMessage[], messageId: string): number {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return 0;
  return messages.slice(index + 1).filter((message) => message.role === "user").length;
}

function uniqueBranchTitle(baseTitle: string, existingTitles: string[]): string {
  const root = `${baseTitle} 分支`;
  if (!existingTitles.includes(root)) return root;
  for (let index = 2; index < 99; index += 1) {
    const next = `${root} ${index}`;
    if (!existingTitles.includes(next)) return next;
  }
  return `${root} ${Date.now()}`;
}

function threadIdFromResult(result: unknown): string | undefined {
  return readPath<string>(result, ["thread", "id"]) ??
    readPath<string>(result, ["threadId"]) ??
    readPath<string>(result, ["id"]) ??
    readPath<string>(result, ["data", "thread", "id"]) ??
    readPath<string>(result, ["data", "threadId"]) ??
    readPath<string>(result, ["data", "id"]);
}

