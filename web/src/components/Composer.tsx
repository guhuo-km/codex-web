import { Check, ChevronDown, FileText, Gauge, LoaderCircle, Maximize2, Minimize2, Plus, Send, ShieldCheck, Square, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ClipboardEvent, type DragEvent } from "react";
import { api } from "../api";
import { createClientId } from "../id";
import type { CapabilityPayload, ComposerCommandMode, ModelRecord, PluginCapability, ReasoningEffort, SendBehavior, SkillCapability, UploadedAttachment, WorkMode } from "../types";
import { clipboardImageFiles } from "./composer-clipboard";
import { submitComposerMessage } from "./composer-submit";

interface ComposerProps {
  disabled: boolean;
  isDraft: boolean;
  projectName?: string;
  projectPath?: string;
  projects: Array<{ cwd: string; name: string }>;
  activeCwd?: string;
  workMode: WorkMode;
  model: string;
  effort: ReasoningEffort;
  text: string;
  attachments: UploadedAttachment[];
  commandMode: ComposerCommandMode | null;
  sendBehavior: SendBehavior;
  onTextChange: (text: string) => void;
  onAttachmentsChange: (attachments: UploadedAttachment[]) => void;
  onCommandModeChange: (mode: ComposerCommandMode | null) => void;
  onRunCompact: () => void;
  onRunInit: () => void;
  onSelectProject: (cwd: string) => void;
  onSelectWorkMode: (mode: WorkMode) => void;
  onSelectModel: (model: string) => void;
  onSelectEffort: (effort: ReasoningEffort) => void;
  onSend: (text: string, attachments: UploadedAttachment[]) => void | Promise<void>;
  isGenerating?: boolean;
  onStop?: () => void;
  capabilities: CapabilityPayload | null;
  onToggleSkill: (path: string, enabled: boolean) => void;
  onTogglePlugin: (pluginId: string, enabled: boolean) => void;
}

const workModes: Array<{ id: WorkMode; label: string; description: string }> = [
  { id: "default", label: "默认", description: "使用 Codex 当前审批策略和沙盒设置" },
  { id: "auto-review", label: "自动审查", description: "保留当前沙盒，由自动审查器处理审批请求" },
  { id: "full-access", label: "完全访问权限", description: "启用 danger-full-access 沙盒，审批策略不变" },
  { id: "yolo", label: "YOLO", description: "启用完整访问并跳过审批，接近 --dangerously-bypass-approvals-and-sandbox" }
];

const efforts: Array<{ id: ReasoningEffort; label: string }> = [
  { id: "low", label: "低" },
  { id: "medium", label: "中" },
  { id: "high", label: "高" },
  { id: "xhigh", label: "超高" }
];

const slashCommands: Array<{
  id: "compact" | "init" | ComposerCommandMode;
  label: string;
  description: string;
  immediate?: boolean;
}> = [
  { id: "compact", label: "/compact", description: "压缩当前会话上下文", immediate: true },
  { id: "init", label: "/init", description: "让 Codex 生成 AGENTS.md", immediate: true },
  { id: "plan", label: "/plan", description: "下一次发送使用计划模式" },
  { id: "goal", label: "/goal", description: "将输入内容设为当前目标" }
];

const commandModeLabels: Record<ComposerCommandMode, string> = {
  plan: "Plan",
  goal: "Goal"
};

export function Composer({
  disabled,
  isDraft,
  projectName,
  projectPath,
  projects,
  activeCwd,
  workMode,
  model,
  effort,
  text,
  attachments,
  commandMode,
  sendBehavior,
  onTextChange,
  onAttachmentsChange,
  onCommandModeChange,
  onRunCompact,
  onRunInit,
  onSelectProject,
  onSelectWorkMode,
  onSelectModel,
  onSelectEffort,
  onSend,
  isGenerating = false,
  onStop,
  capabilities,
  onToggleSkill,
  onTogglePlugin
}: ComposerProps) {
  const [draftText, setDraftText] = useState(text);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [modelLoadError, setModelLoadError] = useState<string | null>(null);
  const [workModeOpen, setWorkModeOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [capabilityMenuOpen, setCapabilityMenuOpen] = useState<"skills" | "plugins" | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const textareaId = useId();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const expandedTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hasText = draftText.trim().length > 0;
  const slashQuery = draftText.startsWith("/") ? draftText.slice(1).trim().toLowerCase() : "";
  const showSlashCommands = draftText.startsWith("/") && !commandMode && !isGenerating;
  const filteredSlashCommands = slashCommands.filter((command) => command.id.includes(slashQuery) || command.label.slice(1).includes(slashQuery));
  const canStop = Boolean(onStop) && isGenerating && !disabled && !hasText && attachments.length === 0;
  const canSend = (hasText || (!isGenerating && attachments.length > 0)) && !disabled && !isSubmitting;

  useEffect(() => {
    void api.models().then((result) => {
      setModelLoadError(null);
      setModels(result.data);
      if (!model && result.data[0]?.id) onSelectModel(result.data[0].id);
    }).catch((error) => {
      console.error("Failed to load models", error);
      setModelLoadError("模型加载失败");
      setModels([]);
    });
  }, []);

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      const target = event.target as Element;
      if (!target.closest(".composer-menu-anchor")) {
        setWorkModeOpen(false);
        setModelOpen(false);
        setProjectOpen(false);
        setCapabilityMenuOpen(null);
      }
    }
    document.addEventListener("pointerdown", closeMenus, true);
    return () => document.removeEventListener("pointerdown", closeMenus, true);
  }, []);

  useEffect(() => {
    if (editorExpanded) expandedTextareaRef.current?.focus();
  }, [editorExpanded]);

  useEffect(() => {
    setDraftText(text);
  }, [text]);

  async function uploadFiles(files: FileList | File[] | null) {
    if (!files) return;
    const uploadedAttachments: UploadedAttachment[] = [];
    for (const file of Array.from(files)) {
      const dataUrl = await readAsDataUrl(file);
      const mimeType = file.type || "application/octet-stream";
      if (mimeType.startsWith("image/")) {
        const uploaded = await api.uploadImage({ name: file.name, mimeType, dataUrl });
        uploadedAttachments.push({ ...uploaded, id: createClientId(), kind: "image" });
      } else {
        const uploaded = await api.uploadFile({ name: file.name, mimeType, dataUrl });
        uploadedAttachments.push({ ...uploaded, id: createClientId(), kind: "file" });
      }
    }
    if (uploadedAttachments.length) onAttachmentsChange([...attachments, ...uploadedAttachments]);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (disabled || isGenerating) return;
    const imageFiles = clipboardImageFiles(event.clipboardData.items);
    if (!imageFiles.length) return;
    event.preventDefault();
    void uploadFiles(imageFiles);
  }

  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types).includes("Files");
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    if (disabled || isGenerating || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setIsDraggingFiles(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (disabled || isGenerating || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingFiles(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setIsDraggingFiles(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (disabled || isGenerating || !hasDraggedFiles(event)) return;
    event.preventDefault();
    setIsDraggingFiles(false);
    void uploadFiles(event.dataTransfer.files);
  }

  async function submit() {
    if (!canSend) return;
    setIsSubmitting(true);
    try {
      await submitComposerMessage({
        text: draftText,
        attachments,
        onSend,
        onTextChange: (nextText) => {
          setDraftText(nextText);
          onTextChange(nextText);
        },
        onAttachmentsChange,
        onError: (error) => console.error("Failed to send message", error)
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function selectSlashCommand(commandId: (typeof slashCommands)[number]["id"]) {
    if (commandId === "compact") {
      setDraftText("");
      onTextChange("");
      onRunCompact();
      return;
    }
    if (commandId === "init") {
      setDraftText("");
      onTextChange("");
      onRunInit();
      return;
    }
    onCommandModeChange(commandId);
    setDraftText("");
    onTextChange("");
  }

  function primaryAction() {
    if (canSend) void submit();
    else if (canStop) onStop?.();
  }

  const selectedMode = workModes.find((item) => item.id === workMode) ?? workModes[0]!;
  const selectedEffort = efforts.find((item) => item.id === effort) ?? efforts[1]!;
  const modelLabel = modelLoadError ?? (model || models[0]?.id || "选择模型");
  const expandButton = (
    <button
      className="composer-expand-button"
      type="button"
      aria-controls={textareaId}
      aria-expanded={editorExpanded}
      title={editorExpanded ? "收起输入框" : "展开输入框"}
      onClick={() => setEditorExpanded((current) => !current)}
      disabled={disabled}
    >
      {editorExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );

  return (
    <footer className={isDraft ? "composer-wrap draft" : "composer-wrap"}>
      <div
        className={isDraggingFiles ? "composer drag-active" : "composer"}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFiles ? <div className="composer-drop-overlay">松开添加文件</div> : null}
        {showSlashCommands && filteredSlashCommands.length ? (
          <div className="composer-slash-menu">
            {filteredSlashCommands.map((command) => (
              <button type="button" key={command.id} onClick={() => selectSlashCommand(command.id)}>
                <span>{command.label}</span>
                <small>{command.description}</small>
              </button>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <div className="composer-attachments">
            {attachments.map((attachment) => (
              <div className={attachment.kind === "image" ? "composer-image" : "composer-file"} key={attachment.id}>
                {attachment.kind === "image" ? (
                  <img src={attachment.previewUrl} alt={attachment.name} />
                ) : (
                  <>
                    <FileText size={18} />
                    <span>{attachment.name}</span>
                  </>
                )}
                <button type="button" onClick={() => onAttachmentsChange(attachments.filter((item) => item.id !== attachment.id))} title="移除文件">
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {commandMode ? (
          <div className="composer-mode-row">
            <span className="composer-mode-token">
              {commandModeLabels[commandMode]}
              <button type="button" onClick={() => onCommandModeChange(null)} title="移除模式">
                <X size={12} />
              </button>
            </span>
          </div>
        ) : null}
        <div className={`composer-editor-shell ${editorExpanded ? "expanded" : ""}`}>
          {expandButton}
          <textarea
            id={textareaId}
            ref={editorExpanded ? expandedTextareaRef : undefined}
            className={editorExpanded ? "composer-expanded-textarea" : ""}
            value={draftText}
            disabled={disabled}
            placeholder={disabled ? "请先选择项目" : commandMode === "goal" ? "输入当前目标..." : isDraft ? "请告诉 Codex 需要构建、修改或检查什么..." : "输入消息..."}
            onChange={(event) => setDraftText(event.target.value)}
            onPaste={handlePaste}
            onKeyDown={(event) => {
              if (event.key === "Escape" && editorExpanded) {
                event.preventDefault();
                setEditorExpanded(false);
                return;
              }
              handleComposerKeyDown(event);
            }}
          />
        </div>
        <div className="composer-toolbar">
          <div className="composer-left-tools">
            <input ref={fileRef} type="file" multiple hidden onChange={(event) => void uploadFiles(event.target.files)} />
            <button className="composer-tool-button" type="button" onClick={() => fileRef.current?.click()} disabled={disabled || isGenerating} title="添加文件">
              <Plus size={16} />
            </button>
            <div className="composer-menu-anchor">
              <button className="composer-select-button" type="button" onClick={() => {
                setWorkModeOpen((current) => !current);
                setModelOpen(false);
                setProjectOpen(false);
                setCapabilityMenuOpen(null);
              }} disabled={disabled || isGenerating} title="工作模式">
                <ShieldCheck size={15} />
                <span>{selectedMode.label}</span>
                <ChevronDown size={13} />
              </button>
              {workModeOpen ? (
                <div className="composer-popover mode-menu">
                  {workModes.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={item.id === workMode ? "active" : ""}
                      onClick={() => {
                        onSelectWorkMode(item.id);
                        setWorkModeOpen(false);
                      }}
                    >
                      <span>{item.label}</span>
                      <small>{item.description}</small>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="composer-menu-anchor">
              <button className="composer-select-button" type="button" onClick={() => {
                setModelOpen((current) => !current);
                setWorkModeOpen(false);
                setProjectOpen(false);
                setCapabilityMenuOpen(null);
              }} disabled={disabled || isGenerating} title="模型和思考强度">
                <Gauge size={15} />
                <span>{modelLabel}</span>
                <b>{selectedEffort.label}</b>
                <ChevronDown size={13} />
              </button>
              {modelOpen ? (
                <div className="composer-popover model-menu">
                  <div className="composer-menu-section">
                    <strong>模型</strong>
                    {modelLoadError ? <div className="capability-empty">{modelLoadError}</div> : null}
                    {!modelLoadError && (models.length ? models : [{ id: model || "gpt-5" }]).map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={item.id === model ? "active" : ""}
                        onClick={() => onSelectModel(item.id)}
                      >
                        {item.name ?? item.id}
                      </button>
                    ))}
                  </div>
                  <div className="composer-menu-section">
                    <strong>思考强度</strong>
                    <div className="effort-grid">
                      {efforts.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          className={item.id === effort ? "active" : ""}
                          onClick={() => onSelectEffort(item.id)}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="composer-menu-anchor">
              <button className="composer-select-button" type="button" onClick={() => {
                setCapabilityMenuOpen((current) => current === "skills" ? null : "skills");
                setWorkModeOpen(false);
                setModelOpen(false);
                setProjectOpen(false);
              }} disabled={isGenerating} title="Skills">
                <span>Skills</span>
                <ChevronDown size={13} />
              </button>
              {capabilityMenuOpen === "skills" ? (
                <CapabilityMenu
                  items={uniqueSkills(capabilities).map((skill) => ({
                    id: skill.path,
                    label: skill.name,
                    sublabel: skill.scope,
                    enabled: skill.enabled,
                    onToggle: () => onToggleSkill(skill.path, !skill.enabled)
                  }))}
                />
              ) : null}
            </div>
            <div className="composer-menu-anchor">
              <button className="composer-select-button" type="button" onClick={() => {
                setCapabilityMenuOpen((current) => current === "plugins" ? null : "plugins");
                setWorkModeOpen(false);
                setModelOpen(false);
                setProjectOpen(false);
              }} disabled={isGenerating} title="插件">
                <span>插件</span>
                <ChevronDown size={13} />
              </button>
              {capabilityMenuOpen === "plugins" ? (
                <CapabilityMenu
                  items={installedPlugins(capabilities).map((plugin) => ({
                    id: plugin.id,
                    label: plugin.name,
                    sublabel: plugin.id,
                    enabled: plugin.enabled,
                    onToggle: () => onTogglePlugin(plugin.id, !plugin.enabled)
                  }))}
                />
              ) : null}
            </div>
          </div>
          <div className="composer-actions">
            <button className={canStop ? "send-button stop" : "send-button"} type="button" disabled={!canStop && !canSend} onClick={primaryAction} title={canStop ? "停止生成" : "发送"}>
              {canStop ? <Square size={15} /> : canSend ? <Send size={16} /> : isGenerating ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
      {isDraft ? (
        <div className="draft-context composer-menu-anchor">
          <button type="button" onClick={() => {
            setProjectOpen((current) => !current);
            setWorkModeOpen(false);
            setModelOpen(false);
            setCapabilityMenuOpen(null);
          }} disabled={!projects.length}>
            <span>{projectName ?? "选择项目"}</span>
            <ChevronDown size={14} />
          </button>
          {projectOpen ? (
            <div className="composer-popover project-picker-menu">
              {projects.map((project) => (
                <button
                  type="button"
                  key={project.cwd}
                  className={project.cwd === activeCwd ? "active" : ""}
                  onClick={() => {
                    onSelectProject(project.cwd);
                    setProjectOpen(false);
                  }}
                >
                  <span>{project.name}</span>
                  <small>{project.cwd}</small>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </footer>
  );

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.key === "Backspace" || event.key === "Delete") && commandMode && !draftText) {
      event.preventDefault();
      onCommandModeChange(null);
      return;
    }
    if (shouldSubmitFromEnter(event, sendBehavior) && canSend) {
      event.preventDefault();
      void submit();
    }
  }
}

export const composerUsesLocalDraftText = true;

function shouldSubmitFromEnter(event: React.KeyboardEvent<HTMLTextAreaElement>, sendBehavior: SendBehavior): boolean {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return false;
  if (sendBehavior === "shiftEnter") return event.shiftKey;
  return !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function CapabilityMenu({
  items
}: {
  items: Array<{ id: string; label: string; sublabel?: string; enabled: boolean; onToggle: () => void }>;
}) {
  return (
    <div className="composer-popover capability-popover">
      {items.length ? items.map((item) => (
        <button
          className={`capability-option ${item.enabled ? "enabled" : ""}`}
          type="button"
          key={item.id}
          onClick={item.onToggle}
          title={item.sublabel}
        >
          <span className="capability-check">{item.enabled ? <Check size={13} /> : null}</span>
          <span className="capability-option-text">
            <span>{item.label}</span>
            {item.sublabel ? <small>{item.sublabel}</small> : null}
          </span>
        </button>
      )) : (
        <div className="capability-empty">暂无项目</div>
      )}
    </div>
  );
}

function uniqueSkills(capabilities: CapabilityPayload | null): SkillCapability[] {
  const byPath = new Map<string, SkillCapability>();
  for (const entry of capabilities?.skills?.data ?? []) {
    for (const skill of entry.skills ?? []) {
      if (isPluginSkill(skill)) continue;
      byPath.set(skill.path, skill);
    }
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isPluginSkill(skill: SkillCapability): boolean {
  return /[\\/]\\.codex[\\/]plugins[\\/]cache[\\/]/i.test(skill.path);
}

function installedPlugins(capabilities: CapabilityPayload | null): PluginCapability[] {
  const byId = new Map<string, PluginCapability>();
  for (const marketplace of capabilities?.plugins?.marketplaces ?? []) {
    for (const plugin of marketplace.plugins ?? []) {
      if (plugin.installed) byId.set(plugin.id, plugin);
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}
