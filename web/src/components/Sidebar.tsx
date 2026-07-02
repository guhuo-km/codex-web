import { Check, ChevronRight, Folder, FolderPlus, Moon, MoreHorizontal, MoreVertical, Palette, Pin, Plus, Settings, SquarePlus, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { api } from "../api";
import type { ModelRecord, ReasoningEffort, SendBehavior, ThemeRecord, ToolGroupCollapseMode, TrashPayload, UiThreadActivityIndicator, UiWorkspace, WorkMode } from "../types";
import { NotificationSettingsPanel } from "./NotificationSettingsPanel";
import { ProjectPickerDialog } from "./ProjectPickerDialog";
import { SecuritySettingsPanel } from "./SecuritySettingsPanel";
import { TitleGenerationSettingsPanel } from "./TitleGenerationSettingsPanel";

interface SidebarProps {
  workspaces: UiWorkspace[];
  loadError?: string | null;
  activeCwd?: string;
  activeThreadId: string | null;
  threadActivityIndicators: Record<string, UiThreadActivityIndicator>;
  onSelectWorkspace: (cwd: string) => void;
  onSelectThread: (threadId: string, cwd: string) => void;
  onAddWorkspace: (cwd: string) => void;
  onQuickCreateWorkspace: () => void;
  onNewThread: (cwd?: string) => void;
  onRenameProject: (cwd: string, name: string) => void;
  onPinProject: (cwd: string) => void;
  onMoveProject: (cwd: string, direction: "up" | "down") => void;
  onDeleteProject: (cwd: string) => void;
  onRestoreProject: (cwd: string) => Promise<void>;
  onPinThread: (cwd: string, threadId: string) => void;
  onRenameThread: (cwd: string, threadId: string, title: string) => void;
  onExportThread: (cwd: string, threadId: string) => void;
  onDeleteThread: (cwd: string, threadId: string) => void;
  onRestoreThread: (cwd: string, threadId: string) => Promise<void>;
  onMoveThread: (cwd: string, threadId: string, targetThreadId: string, placement?: "before" | "after") => void;
  colorMode: "light" | "dark";
  themes: ThemeRecord[];
  activeThemeId: string;
  onToggleColorMode: () => void;
  onSelectTheme: (id: string) => void;
  onCreateTheme: (name: string, css: string) => Promise<void>;
  onDeleteTheme: (id: string) => Promise<void>;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  onToolGroupCollapseModeChange: (mode: ToolGroupCollapseMode) => void;
  approvalDetailsCollapsedByDefault: boolean;
  onToggleApprovalDetailsCollapsedByDefault: () => void;
  renderUserMessagesAsMarkdown: boolean;
  onToggleRenderUserMessagesAsMarkdown: () => void;
  desktopSendBehavior: SendBehavior;
  mobileSendBehavior: SendBehavior;
  activeSendBehaviorDevice: "desktop" | "mobile";
  onDesktopSendBehaviorChange: (value: SendBehavior) => void;
  onMobileSendBehaviorChange: (value: SendBehavior) => void;
  historyCacheTurnLimit: number;
  onHistoryCacheTurnLimitChange: (value: number) => void;
  sidebarWidth: number;
  onSidebarWidthChange: (value: number) => void;
  defaultModel: string;
  defaultWorkMode: WorkMode;
  defaultEffort: ReasoningEffort;
  onDefaultModelChange: (model: string) => void;
  onDefaultWorkModeChange: (mode: WorkMode) => void;
  onDefaultEffortChange: (effort: ReasoningEffort) => void;
  authEnabled: boolean;
  authenticated: boolean;
  savedPasswordEnabled: boolean;
  onAuthSettingsChange: () => void;
  onClearSavedPassword: () => void;
  onLogout: () => void | Promise<void>;
}

export function Sidebar({ workspaces, loadError, activeCwd, activeThreadId, threadActivityIndicators, onSelectWorkspace, onSelectThread, onAddWorkspace, onQuickCreateWorkspace, onNewThread, onRenameProject, onPinProject, onMoveProject, onDeleteProject, onRestoreProject, onPinThread, onRenameThread, onExportThread, onDeleteThread, onRestoreThread, onMoveThread, colorMode, themes, activeThemeId, onToggleColorMode, onSelectTheme, onCreateTheme, onDeleteTheme, toolGroupCollapseMode, onToolGroupCollapseModeChange, approvalDetailsCollapsedByDefault, onToggleApprovalDetailsCollapsedByDefault, renderUserMessagesAsMarkdown, onToggleRenderUserMessagesAsMarkdown, desktopSendBehavior, mobileSendBehavior, activeSendBehaviorDevice, onDesktopSendBehaviorChange, onMobileSendBehaviorChange, historyCacheTurnLimit, onHistoryCacheTurnLimitChange, sidebarWidth, onSidebarWidthChange, defaultModel, defaultWorkMode, defaultEffort, onDefaultModelChange, onDefaultWorkModeChange, onDefaultEffortChange, authEnabled, authenticated, savedPasswordEnabled, onAuthSettingsChange, onClearSavedPassword, onLogout }: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"chat" | "security" | "defaults" | "appearance" | "approvals" | "trash" | "notifications" | "titleGeneration">("chat");
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [themeName, setThemeName] = useState("");
  const [themeDraft, setThemeDraft] = useState("");
  const [deleteThemeTarget, setDeleteThemeTarget] = useState<ThemeRecord | null>(null);
  const [openMenuCwd, setOpenMenuCwd] = useState<string | null>(null);
  const [openThreadMenuId, setOpenThreadMenuId] = useState<string | null>(null);
  const [threadRenameTarget, setThreadRenameTarget] = useState<{ cwd: string; id: string; title: string } | null>(null);
  const [threadRenameValue, setThreadRenameValue] = useState("");
  const [draggingThread, setDraggingThread] = useState<{ cwd: string; id: string } | null>(null);
  const [threadDropPreview, setThreadDropPreview] = useState<{ cwd: string; id: string; placement: "before" | "after" } | null>(null);
  const [renameTarget, setRenameTarget] = useState<UiWorkspace | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [historyCacheDraft, setHistoryCacheDraft] = useState(String(historyCacheTurnLimit));
  const [trash, setTrash] = useState<TrashPayload>({ projects: [], threads: [] });
  const [trashLoading, setTrashLoading] = useState(false);
  const [trashError, setTrashError] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!openMenuCwd) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest(".project-menu") && !target.closest(".project-menu-trigger")) {
        setOpenMenuCwd(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openMenuCwd]);

  useEffect(() => {
    if (!openThreadMenuId) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest(".thread-menu") && !target.closest(".thread-menu-trigger")) {
        setOpenThreadMenuId(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openThreadMenuId]);

  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-width", `${sidebarWidth}px`);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!themeMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest(".theme-menu") && !target.closest(".theme-menu-trigger")) {
        setThemeMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [themeMenuOpen]);

  useEffect(() => {
    setHistoryCacheDraft(String(historyCacheTurnLimit));
  }, [historyCacheTurnLimit]);

  useEffect(() => {
    if (!settingsOpen) return;
    void api.models().then((result) => {
      setModels(result.data);
      setModelLoadError(null);
    }).catch((error) => {
      console.error("Failed to load models", error);
      setModels([]);
      setModelLoadError("模型加载失败");
    });
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen || settingsSection !== "trash") return;
    void loadTrash();
  }, [settingsOpen, settingsSection]);

  function toggleProject(cwd: string) {
    onSelectWorkspace(cwd);
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(cwd)) {
        next.delete(cwd);
      } else {
        next.add(cwd);
      }
      return next;
    });
  }

  function closeProjectMenu() {
    setOpenMenuCwd(null);
  }

  function beginResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    function handleMove(moveEvent: PointerEvent) {
      const nextWidth = Math.min(520, Math.max(240, startWidth + moveEvent.clientX - startX));
      onSidebarWidthChange(nextWidth);
    }
    function handleUp() {
      document.removeEventListener("pointermove", handleMove);
      document.removeEventListener("pointerup", handleUp);
      document.body.classList.remove("resizing-sidebar");
    }
    document.body.classList.add("resizing-sidebar");
    document.addEventListener("pointermove", handleMove);
    document.addEventListener("pointerup", handleUp);
  }

  function commitHistoryCacheDraft() {
    const nextValue = clampNumber(Number(historyCacheDraft), 20, 200, historyCacheTurnLimit);
    setHistoryCacheDraft(String(nextValue));
    if (nextValue !== historyCacheTurnLimit) onHistoryCacheTurnLimitChange(nextValue);
  }

  async function loadTrash() {
    setTrashLoading(true);
    setTrashError(null);
    try {
      setTrash(await api.trash());
    } catch (error) {
      console.error("Failed to load trash", error);
      setTrashError("回收站加载失败");
    } finally {
      setTrashLoading(false);
    }
  }

  async function restoreProject(cwd: string) {
    setTrashError(null);
    try {
      await onRestoreProject(cwd);
      await loadTrash();
    } catch (error) {
      console.error("Failed to restore project", error);
      setTrashError("项目恢复失败");
    }
  }

  async function restoreThread(cwd: string, threadId: string) {
    setTrashError(null);
    try {
      await onRestoreThread(cwd, threadId);
      await loadTrash();
    } catch (error) {
      console.error("Failed to restore thread", error);
      setTrashError("会话恢复失败");
    }
  }

  return (
    <aside className="sidebar" ref={sidebarRef}>
      <div className="sidebar-top-actions">
        <button className="top-action" type="button" onClick={() => setPickerOpen(true)} title="添加项目">
          <FolderPlus size={16} />
          <span>添加项目</span>
        </button>
        <button className="top-icon-action" type="button" onClick={onQuickCreateWorkspace} title="快速新建项目">
          <SquarePlus size={16} />
        </button>
      </div>

      <div className="sidebar-scroll">
        {workspaces.length === 0 ? (
          <div className="sidebar-empty">{loadError ?? "暂无项目"}</div>
        ) : (
          <div className="project-tree">
            {workspaces.map((workspace) => {
              const isExpanded = expanded.has(workspace.cwd);
              return (
                <section className="project-node" key={workspace.cwd}>
                  <div className={`${workspace.cwd === activeCwd ? "project-row active" : "project-row"} ${workspace.pinned ? "pinned" : ""}`}>
                    <button className="project-main" type="button" onClick={() => toggleProject(workspace.cwd)}>
                      <ChevronRight className={isExpanded ? "project-chevron expanded" : "project-chevron"} size={15} />
                      <Folder size={15} />
                      <span>{workspace.name}</span>
                      {workspace.pinned ? <Pin className="pin-state-icon" size={13} aria-label="已置顶" /> : null}
                      {workspace.runningCount > 0 ? <b>{workspace.runningCount}</b> : null}
                    </button>
                    <div className="project-actions">
                      <button
                        className="project-action-button project-menu-trigger"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuCwd((current) => current === workspace.cwd ? null : workspace.cwd);
                        }}
                        title="项目菜单"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      <button
                        className="project-action-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onNewThread(workspace.cwd);
                        }}
                        title="新建对话"
                      >
                        <Plus size={15} />
                      </button>
                    </div>
                    {openMenuCwd === workspace.cwd ? (
                      <div className="project-menu">
                        <div className="project-menu-path" title={workspace.cwd}>{workspace.cwd}</div>
                        <button
                          type="button"
                          onClick={() => {
                            closeProjectMenu();
                            setRenameTarget(workspace);
                            setRenameValue(workspace.name);
                          }}
                        >
                          重命名项目
                        </button>
                        <button type="button" onClick={() => { closeProjectMenu(); onPinProject(workspace.cwd); }}>{workspace.pinned ? "取消置顶项目" : "置顶项目"}</button>
                        <button type="button" onClick={() => { closeProjectMenu(); onMoveProject(workspace.cwd, "up"); }}>向上移动项目</button>
                        <button type="button" onClick={() => { closeProjectMenu(); onMoveProject(workspace.cwd, "down"); }}>向下移动项目</button>
                        <button className="danger" type="button" onClick={() => { closeProjectMenu(); onDeleteProject(workspace.cwd); }}>归档项目</button>
                      </div>
                    ) : null}
                  </div>

                  {isExpanded ? (
                    <div className="thread-list">
                      {workspace.threads.length === 0 ? (
                        <div className="thread-empty">暂无会话</div>
                      ) : (
                        workspace.threads.map((thread) => {
                          const isActiveThread = thread.id === activeThreadId;
                          const activityIndicator = threadActivityIndicators[thread.id];
                          const dropPreviewClass = threadDropPreview?.cwd === workspace.cwd && threadDropPreview.id === thread.id
                            ? ` drop-${threadDropPreview.placement}`
                            : "";
                          return (
                            <div
                              key={thread.id}
                              className={`${isActiveThread ? "thread-item active" : "thread-item"} ${thread.pinned ? "pinned" : ""}${dropPreviewClass}`}
                              draggable
                              onContextMenu={(event) => event.preventDefault()}
                              onDragStart={(event) => {
                                setOpenThreadMenuId(null);
                                setDraggingThread({ cwd: workspace.cwd, id: thread.id });
                                setThreadDropPreview(null);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData("text/plain", thread.id);
                              }}
                              onDragOver={(event) => {
                                if (draggingThread?.cwd === workspace.cwd && draggingThread.id !== thread.id) {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = "move";
                                  const rect = event.currentTarget.getBoundingClientRect();
                                  const placement = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                                  setThreadDropPreview({ cwd: workspace.cwd, id: thread.id, placement });
                                }
                              }}
                              onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                  setThreadDropPreview((current) => current?.id === thread.id ? null : current);
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (draggingThread?.cwd === workspace.cwd && draggingThread.id !== thread.id) {
                                  const placement = threadDropPreview?.id === thread.id ? threadDropPreview.placement : "before";
                                  onMoveThread(workspace.cwd, draggingThread.id, thread.id, placement);
                                }
                                setDraggingThread(null);
                                setThreadDropPreview(null);
                              }}
                              onDragEnd={() => {
                                setDraggingThread(null);
                                setThreadDropPreview(null);
                              }}
                            >
                              <span
                                className={`thread-status-dot ${activityIndicator ?? ""}`}
                                title={activityIndicator ? threadStatusLabel(activityIndicator) : undefined}
                                aria-hidden={!activityIndicator}
                              />
                              <button
                                className="thread-row"
                                type="button"
                                onClick={() => onSelectThread(thread.id, thread.cwd)}
                              >
                                <span className="thread-title">{thread.title}</span>
                                {thread.pinned ? <Pin className="pin-state-icon" size={12} aria-label="已置顶" /> : null}
                              </button>
                              {isActiveThread ? (
                                <button
                                  className="thread-menu-trigger"
                                  type="button"
                                  title="会话菜单"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setOpenThreadMenuId((current) => current === thread.id ? null : thread.id);
                                  }}
                                >
                                  <MoreVertical size={14} />
                                </button>
                              ) : null}
                              {openThreadMenuId === thread.id ? (
                                <div className="thread-menu">
                                  <button type="button" onClick={() => { setOpenThreadMenuId(null); onPinThread(workspace.cwd, thread.id); }}>{thread.pinned ? "取消置顶" : "置顶"}</button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenThreadMenuId(null);
                                      setThreadRenameTarget({ cwd: workspace.cwd, id: thread.id, title: thread.title });
                                      setThreadRenameValue(thread.title);
                                    }}
                                  >
                                    手动编辑标题
                                  </button>
                                  <button type="button" onClick={() => { setOpenThreadMenuId(null); onExportThread(workspace.cwd, thread.id); }}>导出 markdown 对话记录</button>
                                  <button className="danger" type="button" onClick={() => { setOpenThreadMenuId(null); onDeleteThread(workspace.cwd, thread.id); }}>归档会话</button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
      <footer className="sidebar-bottom-bar">
        <div className="sidebar-tool-group">
          <button className="sidebar-tool-button" type="button" title="设置" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
          <button className="sidebar-tool-button" type="button" onClick={onToggleColorMode} title={colorMode === "dark" ? "切换浅色" : "切换深色"}>
            {colorMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            className="sidebar-tool-button theme-menu-trigger"
            type="button"
            onClick={() => setThemeMenuOpen((current) => !current)}
            title="主题设置"
          >
            <Palette size={16} />
          </button>
        </div>
        <button className="sidebar-brand-button" type="button" title="设置">
          Codex Web
        </button>
        {themeMenuOpen ? (
          <div className="theme-menu" ref={themeMenuRef}>
            <div className="theme-menu-heading">主题色</div>
            <div className="theme-menu-list">
              {themes.filter((theme) => theme.source === "builtin").map((theme) => (
                <button className="theme-menu-item" type="button" key={theme.id} onClick={() => { onSelectTheme(theme.id); setThemeMenuOpen(false); }}>
                  <span>{theme.name}</span>
                  {theme.id === activeThemeId ? <Check size={14} /> : null}
                </button>
              ))}
              {themes.filter((theme) => theme.source === "custom").map((theme) => (
                <div className="theme-menu-item custom" key={theme.id}>
                  <button type="button" onClick={() => { onSelectTheme(theme.id); setThemeMenuOpen(false); }}>
                    <span>{theme.name}</span>
                    {theme.id === activeThemeId ? <Check size={14} /> : null}
                  </button>
                  <button className="theme-delete-button" type="button" onClick={() => setDeleteThemeTarget(theme)} title="删除主题">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="theme-menu-edit"
              type="button"
              onClick={() => {
                setThemeName("");
                setThemeDraft("");
                setThemeOpen(true);
                setThemeMenuOpen(false);
              }}
            >
              编辑自定义 CSS
            </button>
          </div>
        ) : null}
      </footer>
      {settingsOpen ? (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
            <header>
              <h2>设置</h2>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} aria-label="关闭设置" title="关闭">×</button>
            </header>
            <div className="settings-layout">
              <nav className="settings-nav" aria-label="设置分类">
                <button type="button" className={settingsSection === "chat" ? "active" : ""} onClick={() => setSettingsSection("chat")}>对话</button>
                <button type="button" className={settingsSection === "security" ? "active" : ""} onClick={() => setSettingsSection("security")}>安全</button>
                <button type="button" className={settingsSection === "approvals" ? "active" : ""} onClick={() => setSettingsSection("approvals")}>审批</button>
                <button type="button" className={settingsSection === "defaults" ? "active" : ""} onClick={() => setSettingsSection("defaults")}>默认值</button>
                <button type="button" className={settingsSection === "titleGeneration" ? "active" : ""} onClick={() => setSettingsSection("titleGeneration")}>AI辅助</button>
                <button type="button" className={settingsSection === "notifications" ? "active" : ""} onClick={() => setSettingsSection("notifications")}>通知</button>
                <button type="button" className={settingsSection === "appearance" ? "active" : ""} onClick={() => setSettingsSection("appearance")}>界面</button>
                <button type="button" className={settingsSection === "trash" ? "active" : ""} onClick={() => setSettingsSection("trash")}>回收站</button>
              </nav>
              <div className="settings-panel">
                {settingsSection === "chat" ? (
                  <>
                    <label className="settings-option">
                      <span>
                        <strong>连续工具调用折叠规则</strong>
                        <small>选择连续工具调用在对话里默认如何显示。</small>
                      </span>
                      <select value={toolGroupCollapseMode} onChange={(event) => onToolGroupCollapseModeChange(event.target.value as ToolGroupCollapseMode)}>
                        <option value="alwaysCollapsed">始终折叠</option>
                        <option value="alwaysExpanded">始终展开</option>
                        <option value="collapseAfterComplete">展开后折叠</option>
                      </select>
                    </label>
                    <label className="settings-option">
                      <span>
                        <strong>以 Markdown 格式渲染用户消息</strong>
                        <small>用户消息按 Markdown 显示标题、列表、代码块和链接。</small>
                      </span>
                      <input type="checkbox" checked={renderUserMessagesAsMarkdown} onChange={onToggleRenderUserMessagesAsMarkdown} />
                    </label>
                    <div className="settings-option settings-option-stack">
                      <span>
                        <strong>消息发送方式</strong>
                        <small>桌面和手机分别保存；当前正在使用{activeSendBehaviorDevice === "mobile" ? "手机" : "桌面"}设置。</small>
                      </span>
                      <label className="settings-inline-select">
                        <span>桌面</span>
                        <select value={desktopSendBehavior} onChange={(event) => onDesktopSendBehaviorChange(event.target.value as SendBehavior)}>
                          <option value="enter">Enter 发送，Shift+Enter 换行</option>
                          <option value="shiftEnter">Enter 换行，Shift+Enter 发送</option>
                        </select>
                      </label>
                      <label className="settings-inline-select">
                        <span>手机</span>
                        <select value={mobileSendBehavior} onChange={(event) => onMobileSendBehaviorChange(event.target.value as SendBehavior)}>
                          <option value="enter">Enter 发送，Shift+Enter 换行</option>
                          <option value="shiftEnter">Enter 换行，Shift+Enter 发送</option>
                        </select>
                      </label>
                    </div>
                  </>
                ) : null}
                {settingsSection === "approvals" ? (
                  <label className="settings-option">
                    <span>
                      <strong>审批详情默认收起</strong>
                      <small>审批卡片默认折叠明细，只显示摘要行；展开后才显示 JSON 详情。</small>
                    </span>
                    <input type="checkbox" checked={approvalDetailsCollapsedByDefault} onChange={onToggleApprovalDetailsCollapsedByDefault} />
                  </label>
                ) : null}
                {settingsSection === "security" ? (
                  <SecuritySettingsPanel
                    authEnabled={authEnabled}
                    authenticated={authenticated}
                    savedPasswordEnabled={savedPasswordEnabled}
                    onAuthSettingsChange={onAuthSettingsChange}
                    onClearSavedPassword={onClearSavedPassword}
                    onLogout={onLogout}
                  />
                ) : null}
                {settingsSection === "defaults" ? (
                  <>
                    <label className="settings-option sidebar-width-setting">
                      <span>
                        <strong>历史消息缓存范围</strong>
                        <small>保留最近浏览范围内的对话轮数，超过后自动卸载远离当前位置的消息段。</small>
                      </span>
                      <input
                        className="settings-number-input"
                        type="number"
                        min={20}
                        max={200}
                        step={10}
                        value={historyCacheDraft}
                        onChange={(event) => setHistoryCacheDraft(event.target.value)}
                        onBlur={commitHistoryCacheDraft}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                          }
                        }}
                      />
                    </label>
                    <label className="settings-option">
                      <span>
                        <strong>默认模型</strong>
                        <small>{modelLoadError ?? "新对话默认使用的模型；留空则使用 Codex 默认模型。"}</small>
                      </span>
                      <select value={defaultModel} onChange={(event) => onDefaultModelChange(event.target.value)}>
                        <option value="">Codex 默认</option>
                        {defaultModel && !models.some((item) => item.id === defaultModel) ? (
                          <option value={defaultModel}>{defaultModel}</option>
                        ) : null}
                        {models.map((item) => (
                          <option value={item.id} key={item.id}>{item.name ?? item.id}</option>
                        ))}
                      </select>
                    </label>
                    <label className="settings-option">
                      <span>
                        <strong>默认审批强度</strong>
                        <small>新对话默认使用的审批和沙盒组合。</small>
                      </span>
                      <select value={defaultWorkMode} onChange={(event) => onDefaultWorkModeChange(event.target.value as WorkMode)}>
                        <option value="default">默认</option>
                        <option value="auto-review">自动审查</option>
                        <option value="full-access">完全访问权限</option>
                        <option value="yolo">YOLO</option>
                      </select>
                    </label>
                    <label className="settings-option">
                      <span>
                        <strong>默认思考强度</strong>
                        <small>新对话默认使用的模型思考强度。</small>
                      </span>
                      <select value={defaultEffort} onChange={(event) => onDefaultEffortChange(event.target.value as ReasoningEffort)}>
                        <option value="low">低</option>
                        <option value="medium">中</option>
                        <option value="high">高</option>
                        <option value="xhigh">超高</option>
                      </select>
                    </label>
                  </>
                ) : null}
                {settingsSection === "notifications" ? (
                  <NotificationSettingsPanel />
                ) : null}
                {settingsSection === "titleGeneration" ? (
                  <TitleGenerationSettingsPanel />
                ) : null}
                {settingsSection === "appearance" ? (
                  <>
                    <label className="settings-option">
                      <span>
                        <strong>侧边栏宽度</strong>
                        <small>拖动侧边栏边缘也会同步更新这个宽度。</small>
                      </span>
                      <input
                        className="settings-number-input"
                        type="number"
                        min={240}
                        max={520}
                        step={10}
                        value={Math.round(sidebarWidth)}
                        onChange={(event) => onSidebarWidthChange(Number(event.target.value))}
                      />
                    </label>
                  </>
                ) : null}
                {settingsSection === "trash" ? (
                  <div className="trash-panel">
                    {trashLoading ? <div className="trash-empty">正在加载回收站...</div> : null}
                    {trashError ? <div className="trash-empty danger">{trashError}</div> : null}
                    {!trashLoading && !trashError && !trash.projects.length && !trash.threads.length ? (
                      <div className="trash-empty">回收站为空</div>
                    ) : null}
                    {trash.projects.length ? (
                      <section className="trash-section">
                        <h3>已归档项目</h3>
                        <div className="trash-list">
                          {trash.projects.map((project) => (
                            <div className="trash-item" key={project.cwd}>
                              <span>
                                <strong>{project.name}</strong>
                                <small title={project.cwd}>{project.cwd}</small>
                              </span>
                              <button type="button" onClick={() => void restoreProject(project.cwd)}>恢复</button>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                    {trash.threads.length ? (
                      <section className="trash-section">
                        <h3>已归档会话</h3>
                        <div className="trash-list">
                          {trash.threads.map((thread) => (
                            <div className="trash-item" key={thread.id}>
                              <span>
                                <strong>{thread.name ?? thread.preview ?? thread.id}</strong>
                                <small title={thread.cwd}>{thread.cwd}</small>
                              </span>
                              <button type="button" onClick={() => void restoreThread(thread.cwd, thread.id)}>恢复</button>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <ProjectPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(path) => {
          onAddWorkspace(path);
          setExpanded((current) => {
            const next = new Set(current);
            next.add(path);
            return next;
          });
          setPickerOpen(false);
        }}
      />
      {renameTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="重命名项目"
            onSubmit={(event) => {
              event.preventDefault();
              const name = renameValue.trim();
              if (name) onRenameProject(renameTarget.cwd, name);
              setRenameTarget(null);
            }}
          >
            <header>
              <h2>重命名项目</h2>
              <button className="icon-button" type="button" onClick={() => setRenameTarget(null)} title="关闭">
                ×
              </button>
            </header>
            <label>
              <span>项目名称</span>
              <input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
            </label>
            <footer>
              <button type="button" onClick={() => setRenameTarget(null)}>取消</button>
              <button className="primary-dialog-action" type="submit" disabled={!renameValue.trim()}>确定</button>
            </footer>
          </form>
        </div>
      ) : null}
      {threadRenameTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="rename-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="编辑会话标题"
            onSubmit={(event) => {
              event.preventDefault();
              const title = threadRenameValue.trim();
              if (title) onRenameThread(threadRenameTarget.cwd, threadRenameTarget.id, title);
              setThreadRenameTarget(null);
            }}
          >
            <header>
              <h2>编辑会话标题</h2>
              <button className="icon-button" type="button" onClick={() => setThreadRenameTarget(null)} title="关闭">
                ×
              </button>
            </header>
            <label>
              <span>标题</span>
              <input autoFocus value={threadRenameValue} onChange={(event) => setThreadRenameValue(event.target.value)} />
            </label>
            <footer>
              <button type="button" onClick={() => setThreadRenameTarget(null)}>取消</button>
              <button className="primary-dialog-action" type="submit" disabled={!threadRenameValue.trim()}>确定</button>
            </footer>
          </form>
        </div>
      ) : null}
      {themeOpen ? (
        <div className="dialog-backdrop" role="presentation">
          <form
            className="theme-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="主题设置"
            onSubmit={async (event) => {
              event.preventDefault();
              await onCreateTheme(themeName, themeDraft);
              setThemeOpen(false);
            }}
          >
            <header>
              <div>
                <h2>主题设置</h2>
                <p>可粘贴 tweakcn 的主题变量，支持浅色和深色两套。</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setThemeOpen(false)} title="关闭">
                ×
              </button>
            </header>
            <label>
              <span>主题名称</span>
              <input
                autoFocus
                value={themeName}
                onChange={(event) => setThemeName(event.target.value)}
                placeholder="自定义主题"
              />
            </label>
            <label>
              <span>自定义主题 CSS</span>
              <textarea
                value={themeDraft}
                onChange={(event) => setThemeDraft(event.target.value)}
                spellCheck={false}
                placeholder={":root {\n  --background: ...;\n  --primary: ...;\n}\n\n.dark {\n  --background: ...;\n  --primary: ...;\n}"}
              />
            </label>
            <footer>
              <button
                type="button"
                onClick={() => {
                  setThemeDraft("");
                }}
              >
                清空
              </button>
              <div>
                <button type="button" onClick={() => setThemeOpen(false)}>取消</button>
                <button className="primary-dialog-action" type="submit" disabled={!themeName.trim() || !themeDraft.trim()}>创建</button>
              </div>
            </footer>
          </form>
        </div>
      ) : null}
      {deleteThemeTarget ? (
        <div className="dialog-backdrop" role="presentation">
          <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除主题">
            <h3>删除主题</h3>
            <p>{deleteThemeTarget.name}</p>
            <div>
              <button type="button" onClick={() => setDeleteThemeTarget(null)}>取消</button>
              <button
                className="danger-action"
                type="button"
                onClick={() => {
                  void onDeleteTheme(deleteThemeTarget.id);
                  setDeleteThemeTarget(null);
                }}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className="sidebar-resizer" onPointerDown={beginResize} title="调整侧栏宽度" />
    </aside>
  );
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function threadStatusLabel(status: UiThreadActivityIndicator): string {
  if (status === "running") return "AI 正在输出";
  if (status === "failed") return "上次回复失败";
  return "有新的回复";
}
