import { ArrowDown, ArrowUp, Check, Clock3, Copy, FileText, Gauge, GitBranch, MessageSquare, Minus, Plus, RotateCcw, Undo2, X } from "lucide-react";
import { forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import { formatDuration, formatTokenCount } from "../display-format";
import { diffStatsForToolCall, fileChangeViews } from "../file-change-display";
import { appendTurnWindow, followLatestTurnWindow, latestTurnWindow, normalizeTurnWindow, prependTurnWindow, type TurnWindow } from "../turn-window";
import type { QueuedSteerMessage, TaskSummary, ToolGroupCollapseMode, UiMessage, UiThread, UiToolCall } from "../types";

const INITIAL_VISIBLE_TURNS = 20;
const TURN_WINDOW_BATCH_SIZE = 10;
const MAX_JUMP_ITEMS = 40;
const PROGRAMMATIC_SCROLL_SUPPRESS_MS = 650;
const FOLLOW_BOTTOM_THRESHOLD = 120;

interface ChatPaneProps {
  thread: UiThread | null;
  isGenerating?: boolean;
  model?: string;
  toolGroupCollapseMode?: ToolGroupCollapseMode;
  renderUserMessagesAsMarkdown?: boolean;
  historyCacheTurnLimit?: number;
  queuedSteers?: QueuedSteerMessage[];
  runningTask?: TaskSummary;
  onRemoveQueuedSteer?: (id: string) => void;
  onRollbackMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  isMobileLayout?: boolean;
  mobileJumpRailOpen?: boolean;
  onRequestCollapseMobileJumpRail?: () => void;
}

export const isMemoizedChatPane = true;

export const ChatPane = memo(function ChatPane({
  thread,
  isGenerating = false,
  model,
  toolGroupCollapseMode = "alwaysExpanded",
  renderUserMessagesAsMarkdown = false,
  historyCacheTurnLimit = 60,
  queuedSteers = [],
  runningTask,
  onRemoveQueuedSteer,
  onRollbackMessage,
  onForkMessage,
  isMobileLayout = false,
  mobileJumpRailOpen = false,
  onRequestCollapseMobileJumpRail
}: ChatPaneProps) {
  const showEmpty = !thread || (thread.messages.length === 0 && !isGenerating);
  const messages = useMemo(() => thread?.messages ?? [], [thread?.messages]);
  const turns = useMemo(() => groupMessagesByTurn(messages), [messages]);
  const cacheTurnLimit = Math.max(INITIAL_VISIBLE_TURNS, Math.min(200, Math.floor(historyCacheTurnLimit)));
  const [visibleTurnWindow, setVisibleTurnWindow] = useState<TurnWindow>(() => latestTurnWindow(turns.length, INITIAL_VISIBLE_TURNS));
  const visibleTurnStartIndex = visibleTurnWindow.start;
  const visibleTurns = useMemo(() => turns.slice(visibleTurnWindow.start, visibleTurnWindow.end), [turns, visibleTurnWindow]);
  const visibleMessages = useMemo(() => visibleTurns.flatMap((turn) => turn.messages), [visibleTurns]);
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const restoreScrollRef = useRef<ScrollRestoreSnapshot | null>(null);
  const userScrollIntentRef = useRef(false);
  const followingBottomRef = useRef(true);
  const previousScrollTopRef = useRef(0);
  const suppressScrollUntilRef = useRef(0);
  const bottomScrollTimersRef = useRef<number[]>([]);
  const previousTurnCountRef = useRef(turns.length);
  const jumpRailRef = useRef<QuickJumpHandle | null>(null);

  useLayoutEffect(() => {
    setVisibleTurnWindow(latestTurnWindow(turns.length, INITIAL_VISIBLE_TURNS));
    restoreScrollRef.current = null;
    userScrollIntentRef.current = false;
    followingBottomRef.current = true;
    previousScrollTopRef.current = 0;
    previousTurnCountRef.current = turns.length;
    bottomScrollTimersRef.current.forEach((timerId) => window.clearTimeout(timerId));
    bottomScrollTimersRef.current = [];
  }, [thread?.id]);

  useLayoutEffect(() => {
    const previousTurnCount = previousTurnCountRef.current;
    previousTurnCountRef.current = turns.length;
    setVisibleTurnWindow((current) => followLatestTurnWindow(current, previousTurnCount, turns.length, cacheTurnLimit, INITIAL_VISIBLE_TURNS));
  }, [turns.length, cacheTurnLimit]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || showEmpty) return;
    if (restoreScrollRef.current) {
      const snapshot = restoreScrollRef.current;
      restoreScrollRef.current = null;
      restoreScrollPosition(scrollElement, snapshot);
      suppressProgrammaticScroll();
      return;
    }
  }, [visibleTurnWindow, visibleMessages.length, showEmpty]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || showEmpty) return;
    let firstFrameId = 0;
    let secondFrameId = 0;
    const scrollToBottom = () => {
      suppressProgrammaticScroll();
      scrollElement.scrollTop = scrollElement.scrollHeight;
      followingBottomRef.current = true;
      previousScrollTopRef.current = scrollElement.scrollTop;
    };
    firstFrameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        scrollToBottom();
        const timerId = window.setTimeout(() => {
          scrollToBottom();
          bottomScrollTimersRef.current = bottomScrollTimersRef.current.filter((id) => id !== timerId);
        }, 180);
        bottomScrollTimersRef.current.push(timerId);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrameId);
      window.cancelAnimationFrame(secondFrameId);
    };
  }, [thread?.id, showEmpty]);

  useLayoutEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement || showEmpty || restoreScrollRef.current) return;
    if (visibleTurnWindow.end !== turns.length) return;
    if (!followingBottomRef.current) return;
    suppressProgrammaticScroll();
    scrollElement.scrollTop = scrollElement.scrollHeight;
    previousScrollTopRef.current = scrollElement.scrollTop;
  }, [messages, turns.length, isGenerating, visibleTurnWindow.end, showEmpty]);

  useEffect(() => {
    if (!mobileJumpRailOpen) return;
    userScrollIntentRef.current = false;
    suppressProgrammaticScroll();
  }, [mobileJumpRailOpen]);

  function loadOlderTurns() {
    const scrollElement = scrollRef.current;
    if (!scrollElement || visibleTurnWindow.start <= 0) return;
    restoreScrollRef.current = captureScrollRestore(scrollElement, "top");
    suppressProgrammaticScroll();
    setVisibleTurnWindow((current) => prependTurnWindow(current, turns.length, TURN_WINDOW_BATCH_SIZE, cacheTurnLimit));
  }

  function loadNewerTurns() {
    const scrollElement = scrollRef.current;
    if (!scrollElement || visibleTurnWindow.end >= turns.length) return;
    restoreScrollRef.current = captureScrollRestore(scrollElement, "center");
    suppressProgrammaticScroll();
    setVisibleTurnWindow((current) => appendTurnWindow(current, turns.length, TURN_WINDOW_BATCH_SIZE, cacheTurnLimit));
  }

  function handleScroll() {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    jumpRailRef.current?.syncActiveMessage();
    if (Date.now() < suppressScrollUntilRef.current) {
      previousScrollTopRef.current = scrollElement.scrollTop;
      return;
    }
    if (mobileJumpRailOpen && userScrollIntentRef.current) {
      onRequestCollapseMobileJumpRail?.();
    }
    const distanceFromBottom = scrollElement.scrollHeight - scrollElement.clientHeight - scrollElement.scrollTop;
    const isNearBottom = distanceFromBottom <= FOLLOW_BOTTOM_THRESHOLD;
    if (isNearBottom && visibleTurnWindow.end === turns.length) {
      followingBottomRef.current = true;
    } else if (userScrollIntentRef.current && scrollElement.scrollTop < previousScrollTopRef.current - 2) {
      followingBottomRef.current = false;
    }
    previousScrollTopRef.current = scrollElement.scrollTop;
    if (!userScrollIntentRef.current) {
      return;
    }
    if (isGenerating && followingBottomRef.current) {
      return;
    }
    if (restoreScrollRef.current) {
      return;
    }
    const canOverflowLoad = scrollElement.scrollHeight > scrollElement.clientHeight + 180;
    if (!canOverflowLoad) {
      return;
    }
    if (visibleTurnWindow.start > 0 && scrollElement.scrollTop < 180) {
      loadOlderTurns();
      return;
    }
    if (visibleTurnWindow.end < turns.length && distanceFromBottom < 180) {
      loadNewerTurns();
    }
  }

  function markUserScrollIntent() {
    userScrollIntentRef.current = true;
  }

  function markWheelScrollIntent(deltaY: number) {
    markUserScrollIntent();
    if (deltaY < 0) {
      followingBottomRef.current = false;
    }
  }

  function suppressProgrammaticScroll() {
    suppressScrollUntilRef.current = Date.now() + PROGRAMMATIC_SCROLL_SUPPRESS_MS;
  }

  return (
    <main className={`chat-pane ${mobileJumpRailOpen ? "mobile-jump-rail-open" : ""}`}>
      <div
        className="event-list conversation-scroll"
        ref={scrollRef}
        onScroll={handleScroll}
        onWheel={(event) => markWheelScrollIntent(event.deltaY)}
        onTouchStart={markUserScrollIntent}
        onPointerDown={markUserScrollIntent}
        onKeyDown={markUserScrollIntent}
      >
        {showEmpty ? (
          <div className="empty-state">
            <MessageSquare size={40} />
            <h2>{thread ? "暂无消息" : "选择一个会话"}</h2>
          </div>
        ) : (
          <div className="conversation-shell">
            <div className="message-list">
              {visibleTurnWindow.start > 0 ? (
                <button className="load-older-turns" type="button" onClick={loadOlderTurns}>
                  加载更早的 {Math.min(TURN_WINDOW_BATCH_SIZE, visibleTurnWindow.start)} 轮对话
                </button>
              ) : null}
              {visibleMessages.map((message, index) => (
              <ChatMessage
                key={message.id}
                message={message}
                isLast={index === visibleMessages.length - 1}
                model={model}
                toolGroupCollapseMode={toolGroupCollapseMode}
                renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
                queuedSteers={queuedSteers}
                onRemoveQueuedSteer={onRemoveQueuedSteer}
                onRollbackMessage={onRollbackMessage}
                onForkMessage={onForkMessage}
                onPreviewImage={setPreviewImage}
              />
              ))}
              {isGenerating && !messages.some((message) => message.role === "assistant" && message.isStreaming) ? (
                <ChatMessage
                  message={{
                    id: "pending-assistant-visible",
                    role: "assistant",
                    text: "",
                    createdAt: parseTaskStartedAt(runningTask) ?? Date.now(),
                    turnId: runningTask?.turnId,
                    turnStartedAt: parseTaskStartedAt(runningTask) ?? undefined,
                    synthetic: runningTask?.kind === "compact" ? "manualCompact" : undefined,
                    isStreaming: true
                  }}
                  isLast
                  model={model}
                  toolGroupCollapseMode={toolGroupCollapseMode}
                  renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
                  queuedSteers={queuedSteers}
                  onRemoveQueuedSteer={onRemoveQueuedSteer}
                  onRollbackMessage={onRollbackMessage}
                  onForkMessage={onForkMessage}
                  onPreviewImage={setPreviewImage}
                />
              ) : null}
              {visibleTurnWindow.end < turns.length ? (
                <button className="load-older-turns" type="button" onClick={loadNewerTurns}>
                  加载更晚的 {Math.min(TURN_WINDOW_BATCH_SIZE, turns.length - visibleTurnWindow.end)} 轮对话
                </button>
              ) : null}
              <div ref={bottomRef} className="conversation-bottom-anchor" aria-hidden="true" />
            </div>
            {visibleTurns.length > 1 ? (
              <QuickJump
                ref={jumpRailRef}
                turns={visibleTurns}
                visibleTurnStartIndex={visibleTurnStartIndex}
                totalTurnCount={turns.length}
                onBeforeJump={suppressProgrammaticScroll}
                isMobileLayout={isMobileLayout}
                mobileJumpRailOpen={mobileJumpRailOpen}
                onRequestCollapseMobileJumpRail={onRequestCollapseMobileJumpRail}
              />
            ) : null}
          </div>
        )}
      </div>
      {previewImage ? (
        <ImagePreviewOverlay image={previewImage} onClose={() => setPreviewImage(null)} />
      ) : null}
    </main>
  );
});

function parseTaskStartedAt(task: TaskSummary | undefined): number | null {
  if (!task?.startedAt) return null;
  const parsed = Date.parse(task.startedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function ChatMessage({
  message,
  isLast,
  model,
  toolGroupCollapseMode,
  renderUserMessagesAsMarkdown,
  queuedSteers,
  onRemoveQueuedSteer,
  onRollbackMessage,
  onForkMessage,
  onPreviewImage
}: {
  message: UiMessage;
  isLast: boolean;
  model?: string;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  renderUserMessagesAsMarkdown: boolean;
  queuedSteers: QueuedSteerMessage[];
  onRemoveQueuedSteer?: (id: string) => void;
  onRollbackMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onPreviewImage: (image: { src: string; name: string }) => void;
}) {
  if (message.role === "system") {
    return (
      <div className="conversation-system-marker" id={`message-${message.id}`}>
        <span className="conversation-system-marker-line" />
        <span className="conversation-system-marker-label">{message.text || "上下文已压缩"}</span>
        <span className="conversation-system-marker-line" />
      </div>
    );
  }
  const isUser = message.role === "user";
  const hasText = message.text.trim().length > 0;
  const hasParts = Boolean(message.assistantParts?.length);
  const steerItems = isUser ? [] : mergeSteerMessages(message.steerMessages, message.isStreaming ? queuedSteers : []);
  const hasSteerParts = Boolean(message.assistantParts?.some((part) => part.type === "steer"));

  return (
    <article
      className={`conversation-message ${isUser ? "user" : "assistant"} ${message.isStreaming ? "streaming" : ""}`}
      id={`message-${message.id}`}
    >
      <MessageHeader message={message} model={model} />
      <div className="conversation-message-body">
        <div className="message-content">
          <MessageAttachments message={message} onPreviewImage={onPreviewImage} />
          {hasParts && !isUser ? (
            <AssistantParts parts={message.assistantParts ?? []} toolGroupCollapseMode={toolGroupCollapseMode} isStreaming={Boolean(message.isStreaming)} />
          ) : hasText ? (
            isUser ? (
              <div className="user-message-bubble">
                {renderUserMessagesAsMarkdown ? <MarkdownText text={message.text} className="user-message-markdown" /> : <UserText text={message.text} />}
              </div>
            ) : <MarkdownText text={message.text} streaming={message.isStreaming} />
          ) : null}
        </div>
      </div>
      {message.isStreaming && !isUser ? (
        <>
          <RunningTurnBar message={message} />
          {!hasSteerParts ? <QueuedSteerStack items={steerItems} onRemove={onRemoveQueuedSteer} /> : null}
        </>
      ) : (hasText || hasParts || message.images?.length || message.attachments?.length || isLast) ? (
        <>
          <MessageActions
            message={message}
            alignRight={isUser}
            onRollback={isUser ? onRollbackMessage : undefined}
            onFork={!isUser ? onForkMessage : undefined}
          />
          {!isUser && message.statusText ? <div className={`message-status-line ${message.statusTone ?? "muted"}`}>{message.statusText}</div> : null}
          {!isUser ? <MessageStats message={message} /> : null}
        </>
      ) : null}
    </article>
  );
}

function MessageAttachments({ message, onPreviewImage }: { message: UiMessage; onPreviewImage: (image: { src: string; name: string }) => void }) {
  const files = message.attachments?.filter((attachment) => attachment.kind === "file") ?? [];
  if (!message.images?.length && !files.length) return null;
  return (
    <div className="message-attachments">
      {message.images?.length ? (
        <div className="message-images">
          {message.images.map((image) => (
            <button
              className="message-image-thumb"
              type="button"
              key={image.id}
              onClick={() => onPreviewImage({ src: image.previewUrl, name: image.name })}
              title="预览图片"
            >
              <img src={image.previewUrl} alt={image.name} />
            </button>
          ))}
        </div>
      ) : null}
      {files.length ? (
        <div className="message-files">
          {files.map((file) => (
            <div className="message-file-card" key={file.id} title={file.path}>
              <FileText size={17} />
              <span>{file.name}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImagePreviewOverlay({ image, onClose }: { image: { src: string; name: string }; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((current) => clampZoom(current * 1.15));
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((current) => clampZoom(current / 1.15));
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        resetZoom();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    resetZoom();
  }, [image.src]);

  function resetZoom() {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }

  function clampZoom(value: number) {
    return Math.min(6, Math.max(1, Number(value.toFixed(3))));
  }

  function zoomBy(direction: 1 | -1) {
    setZoom((current) => {
      const next = clampZoom(current * (direction > 0 ? 1.15 : 1 / 1.15));
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 1 : -1);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom <= 1) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: offset.x,
      originY: offset.y
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    setOffset({
      x: dragState.originX + (event.clientX - dragState.startX),
      y: dragState.originY + (event.clientY - dragState.startY)
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
  }

  function handleDoubleClick() {
    if (zoom > 1) {
      resetZoom();
      return;
    }
    setZoom(2);
  }

  return (
    <div className="image-preview-overlay" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
      <div className="image-preview-toolbar" onClick={(event) => event.stopPropagation()}>
        <button className="image-preview-control" type="button" onClick={onClose} aria-label="关闭预览" title="关闭预览">
          <X size={20} />
        </button>
        <button className="image-preview-control" type="button" onClick={() => zoomBy(-1)} aria-label="缩小" title="缩小">
          <Minus size={18} />
        </button>
        <button className="image-preview-control" type="button" onClick={resetZoom} aria-label="重置缩放" title="重置缩放">
          <RotateCcw size={17} />
        </button>
        <button className="image-preview-control" type="button" onClick={() => zoomBy(1)} aria-label="放大" title="放大">
          <Plus size={18} />
        </button>
      </div>
      <div
        className={`image-preview-stage ${zoom > 1 ? "zoomed" : ""}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={image.src}
          alt={image.name}
          onClick={(event) => event.stopPropagation()}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${zoom})`,
            cursor: zoom > 1 ? "grab" : "zoom-in"
          }}
          draggable={false}
        />
      </div>
    </div>
  );
}

function AssistantParts({ parts, toolGroupCollapseMode, isStreaming }: { parts: NonNullable<UiMessage["assistantParts"]>; toolGroupCollapseMode: ToolGroupCollapseMode; isStreaming: boolean }) {
  const [openToolId, setOpenToolId] = useState<string | null>(null);
  const [toggledToolGroups, setToggledToolGroups] = useState<Set<string>>(() => new Set());
  const partGroups = useMemo(() => groupAssistantParts(parts), [parts]);

  useEffect(() => {
    setToggledToolGroups(new Set());
  }, [parts, toolGroupCollapseMode, isStreaming]);

  function toggleToolGroup(groupId: string) {
    setToggledToolGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  return (
    <div className="assistant-part-list">
      {partGroups.map((group) => {
        if (group.kind === "text") return <MarkdownText key={group.part.id} text={group.part.text} />;
        if (group.kind === "reasoning") return <ReasoningBlock key={group.part.id} text={group.part.text} summary={group.part.summary} />;
        if (group.kind === "steer") return <SteerInline key={group.part.id} item={group.part} />;
        if (group.parts.length === 1) {
          const part = group.parts[0]!;
          return (
            <ToolCallCard
              key={part.id}
              toolCall={part.toolCall}
              open={openToolId === part.id}
              onToggle={() => setOpenToolId((current) => current === part.id ? null : part.id)}
            />
          );
        }
        const defaultCollapsed = toolGroupCollapseMode === "alwaysCollapsed" || (toolGroupCollapseMode === "collapseAfterComplete" && !isStreaming);
        const collapsed = defaultCollapsed ? !toggledToolGroups.has(group.id) : toggledToolGroups.has(group.id);
        return (
          <div className={`tool-call-group ${collapsed ? "collapsed" : ""}`} key={group.id}>
            <button className="tool-call-group-toggle" type="button" onClick={() => toggleToolGroup(group.id)} aria-expanded={!collapsed}>
              <span className="tool-call-group-chevron" aria-hidden="true" />
              <span>{toolGroupSummary(group.parts.map((part) => part.toolCall))}</span>
            </button>
            <div className="tool-call-group-body">
              {collapsed ? null : group.parts.map((part) => (
                <ToolCallCard
                  key={part.id}
                  toolCall={part.toolCall}
                  open={openToolId === part.id}
                  onToggle={() => setOpenToolId((current) => current === part.id ? null : part.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToolCallCard({ toolCall, open, onToggle }: { toolCall: UiToolCall; open: boolean; onToggle: () => void }) {
  const output = toolCall.aggregatedOutput?.trim();
  const detailItems = toolDetailItems(toolCall);
  const fileChangeStats = toolCall.type === "fileChange" ? diffStatsForToolCall(toolCall) : null;
  const fileChanges = toolCall.type === "fileChange" ? fileChangeViews(toolCall) : [];

  return (
    <section className={`tool-call-card ${statusClass(toolCall.status)} ${open ? "open" : ""}`}>
      <button className="tool-call-summary" type="button" onClick={onToggle}>
        <span className="tool-call-icon" aria-hidden="true" style={{ "--tool-icon": `url("${toolIcon(toolCall.type)}")` } as CSSProperties} />
        <span className="tool-call-main">
          <span className="tool-call-title">{toolTitle(toolCall)}</span>
          <span className="tool-call-subtitle">
            {fileChanges.length > 1 ? (
              <span className="tool-file-summary-list">
                {fileChanges.map((view) => (
                  <span className="tool-file-summary-item" key={`${view.change.kind ?? "change"}:${view.change.path}:${view.change.movePath ?? ""}`}>
                    <span>{shortPathName(view.change.movePath ?? view.change.path)}</span>
                    <DiffStats stats={view.stats} />
                  </span>
                ))}
              </span>
            ) : fileChangeStats && (fileChangeStats.added > 0 || fileChangeStats.removed > 0) ? (
              <DiffStats stats={fileChangeStats} />
            ) : (
              statusLabel(toolCall.status)
            )}
            {toolCall.durationMs != null ? ` · ${formatDuration(toolCall.durationMs)}` : ""}
          </span>
        </span>
      </button>
      <div className={`tool-call-detail ${open ? "open" : "closed"}`} aria-hidden={!open}>
        <div className="tool-call-detail-inner">
          {fileChanges.length ? (
            <div className="tool-file-change-list">
              {fileChanges.map((view) => (
                <section className="tool-file-change" key={`${view.change.kind ?? "change"}:${view.change.path}:${view.change.movePath ?? ""}`}>
                  <div className="tool-file-change-header">
                    <span className="tool-file-change-kind">{view.label}</span>
                    <code>{view.path}</code>
                    {view.stats.added > 0 || view.stats.removed > 0 ? <DiffStats stats={view.stats} /> : null}
                  </div>
                  {view.code.trim() ? <CodeBlock code={view.code} language="diff" /> : <div className="tool-call-empty">无 diff 内容</div>}
                </section>
              ))}
            </div>
          ) : null}
          {detailItems.map((item) => (
            <div className="tool-call-kv" key={item.label}>
              {item.kind === "diff" ? null : <span>{item.label}</span>}
              {item.kind === "code" ? <code>{item.value}</code> : item.kind === "diff" ? <CodeBlock code={item.value} language="diff" /> : <pre>{item.value}</pre>}
            </div>
          ))}
          {output ? (
            <div className="tool-call-output">
              <span>输出</span>
              <pre>{stripAnsi(output)}</pre>
            </div>
          ) : detailItems.length === 0 ? (
            <div className="tool-call-empty">暂无输出</div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

type AssistantPart = NonNullable<UiMessage["assistantParts"]>[number];

type AssistantPartGroup =
  | { kind: "text"; part: Extract<AssistantPart, { type: "text" }> }
  | { kind: "reasoning"; part: Extract<AssistantPart, { type: "reasoning" }> }
  | { kind: "steer"; part: Extract<AssistantPart, { type: "steer" }> }
  | { kind: "tools"; id: string; parts: Array<Extract<AssistantPart, { type: "tool" }>> };

function groupAssistantParts(parts: NonNullable<UiMessage["assistantParts"]>): AssistantPartGroup[] {
  const groups: AssistantPartGroup[] = [];
  let toolBuffer: Array<Extract<AssistantPart, { type: "tool" }>> = [];

  function flushTools() {
    if (!toolBuffer.length) return;
    groups.push({
      kind: "tools",
      id: `tools-${toolBuffer[0]?.id ?? groups.length}-${toolBuffer.length}`,
      parts: toolBuffer
    });
    toolBuffer = [];
  }

  for (const part of parts) {
    if (part.type === "tool") {
      toolBuffer.push(part);
    } else if (part.type === "reasoning") {
      flushTools();
      groups.push({ kind: "reasoning", part });
    } else if (part.type === "steer") {
      flushTools();
      groups.push({ kind: "steer", part });
    } else {
      flushTools();
      groups.push({ kind: "text", part });
    }
  }
  flushTools();
  return groups;
}

function toolGroupSummary(toolCalls: UiToolCall[]): string {
  const changedFiles = new Set<string>();
  let webSearches = 0;
  let commands = 0;
  let mcpCalls = 0;

  for (const toolCall of toolCalls) {
    if (toolCall.type === "fileChange") {
      for (const change of toolCall.changes ?? []) {
        if (change.path) changedFiles.add(change.path);
        if (change.movePath) changedFiles.add(change.movePath);
      }
    }
    if (toolCall.type === "webSearch") webSearches += 1;
    if (toolCall.type === "commandExecution") commands += 1;
    if (toolCall.type === "mcpToolCall") mcpCalls += 1;
  }

  const segments = [
    changedFiles.size ? `更改了 ${changedFiles.size} 个文件` : "",
    webSearches ? `进行了 ${webSearches} 次网络搜索` : "",
    commands ? `执行了 ${commands} 次命令` : "",
    mcpCalls ? `调用了 ${mcpCalls} 次 MCP 工具` : ""
  ].filter(Boolean);

  return segments.length ? segments.join("，") : `进行了 ${toolCalls.length} 次工具调用`;
}

function DiffStats({ stats }: { stats: { added: number; removed: number } }) {
  return (
    <span className="tool-diff-stats">
      <span className="removed">-{stats.removed}</span>
      <span className="added">+{stats.added}</span>
    </span>
  );
}

function MessageHeader({ message, model }: { message: UiMessage; model?: string }) {
  const isUser = message.role === "user";
  const label = isUser ? "用户" : (model?.trim() || "Codex");

  return (
    <div className="message-avatar-row">
      <div className="message-meta">
        {isUser && message.createdAt != null ? <span className="message-time">{formatTimestamp(message.createdAt)}</span> : null}
        <strong>{label}</strong>
        {!isUser && message.createdAt != null ? <span className="message-time">{formatTimestamp(message.createdAt)}</span> : null}
        {message.isStreaming ? (
          <span className="message-live-indicator">生成中</span>
        ) : null}
      </div>
    </div>
  );
}

function UserText({ text }: { text: string }) {
  return <div className="user-message-text">{text}</div>;
}

export function MarkdownText({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const normalized = normalizeLocalMarkdownLinks(text);

  if (streaming) {
    return (
      <div className={`assistant-markdown assistant-markdown-streaming ${className ?? ""}`.trim()}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {stabilizeStreamingMarkdown(normalized)}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <div className={`assistant-markdown ${className ?? ""}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeKatex]}
        components={markdownComponents}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "kbd",
    "sub",
    "sup",
    "mark",
    "details",
    "summary"
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      ...(defaultSchema.attributes?.["*"] ?? []),
      "className",
      "aria-hidden",
      "aria-label"
    ],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      "href",
      "title"
    ],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      "className"
    ],
    div: [
      ...(defaultSchema.attributes?.div ?? []),
      "className"
    ],
    span: [
      ...(defaultSchema.attributes?.span ?? []),
      "className"
    ],
    input: [
      ...(defaultSchema.attributes?.input ?? []),
      "type",
      "checked",
      "disabled"
    ],
    th: [
      ...(defaultSchema.attributes?.th ?? []),
      "align"
    ],
    td: [
      ...(defaultSchema.attributes?.td ?? []),
      "align"
    ]
  }
};

const markdownComponents = {
  a({ href, children }: HTMLAttributes<HTMLAnchorElement> & { href?: string }) {
    return (
      <a href={href} title={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    );
  },
  code({ inline, className, children }: HTMLAttributes<HTMLElement> & { inline?: boolean }) {
    const raw = String(children ?? "").replace(/\n$/, "");
    const match = /language-([\w-]+)/.exec(className ?? "");
    const language = match?.[1]?.toLowerCase();
    if (inline || !raw.includes("\n")) return <code className={className}>{children}</code>;
    if (language === "mermaid") return <MermaidBlock source={raw} />;
    if (isFileTreeLanguage(language)) return <FileTreeBlock source={raw} language={language} />;
    return <CodeBlock code={raw} language={language} />;
  },
  pre({ children }: HTMLAttributes<HTMLPreElement>) {
    return <>{children}</>;
  },
  input(props: HTMLAttributes<HTMLInputElement> & { checked?: boolean; type?: string }) {
    if (props.type === "checkbox") {
      return <input {...props} type="checkbox" disabled checked={Boolean(props.checked)} readOnly />;
    }
    return <input {...props} />;
  }
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const highlighted = useMemo(() => highlightCode(code, language), [code, language]);
  const isDiff = language === "diff" || language === "patch";
  const rows = useMemo(() => isDiff ? diffDisplayRows(code, highlighted) : codeDisplayRows(code, highlighted), [code, highlighted, isDiff]);

  async function copyCode() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className={`markdown-code-block ${isDiff ? "markdown-diff-block" : ""}`}>
      <figcaption>
        <span>{language || "text"}</span>
        <button type="button" onClick={() => void copyCode()} aria-label="复制代码" title="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </figcaption>
      <pre>
        <code>
          {rows.map((row) => (
            <span className={`code-line ${row.className}`} key={`${row.key}-${row.line}`}>
              <span className="code-line-number">{row.lineNumber ?? ""}</span>
              <span className="code-line-content" dangerouslySetInnerHTML={{ __html: row.html || " " }} />
            </span>
          ))}
        </code>
      </pre>
    </figure>
  );
}

function FileTreeBlock({ source, language }: { source: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const rows = source.replace(/\r\n/g, "\n").split("\n").filter((line) => line.trim().length > 0);

  async function copyTree() {
    await navigator.clipboard.writeText(source);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <figure className="markdown-file-tree">
      <figcaption>
        <span>{language || "tree"}</span>
        <button type="button" onClick={() => void copyTree()} aria-label="复制文件树" title="复制文件树">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </figcaption>
      <div className="file-tree-list">
        {rows.map((line, index) => {
          const parsed = parseFileTreeLine(line);
          return (
            <div className={`file-tree-row ${parsed.kind}`} style={{ "--tree-depth": parsed.depth } as CSSProperties} key={`${index}-${line}`}>
              <span className="file-tree-guide" aria-hidden="true" />
              <span className="file-tree-icon" aria-hidden="true">{parsed.kind === "folder" ? "dir" : "file"}</span>
              <span className="file-tree-name">{parsed.name}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function MermaidBlock({ source }: { source: string }) {
  const reactId = useId();
  const themeSignature = useMermaidThemeSignature();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setError(null);
    import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: mermaidThemeVariables()
        });
        return mermaid.render(`mermaid-${sanitizeDomId(reactId)}-${hashText(`${themeSignature}\n${source}`)}`, source);
      })
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
        }
      })
      .catch((renderError: unknown) => {
        if (!cancelled) {
          setSvg(null);
          setError(renderError instanceof Error ? renderError.message : "图表渲染失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [reactId, source, themeSignature]);

  if (error) {
    return (
      <figure className="markdown-mermaid markdown-mermaid-error">
        <figcaption>Mermaid 图表渲染失败</figcaption>
        <pre>{error}</pre>
      </figure>
    );
  }

  return (
    <figure className="markdown-mermaid">
      {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="markdown-mermaid-loading">正在渲染图表</div>}
    </figure>
  );
}

function useMermaidThemeSignature() {
  const [signature, setSignature] = useState(() => readMermaidThemeSignature());

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setSignature(readMermaidThemeSignature());
    const observer = new MutationObserver(update);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"]
    });
    window.addEventListener("storage", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", update);
    };
  }, []);

  return signature;
}

function readMermaidThemeSignature() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  return [
    root.dataset.theme ?? "",
    root.classList.contains("dark") ? "dark" : "light",
    "--background",
    "--foreground",
    "--muted",
    "--muted-foreground",
    "--border",
    "--primary",
    "--primary-foreground"
  ].map((key) => key.startsWith("--") ? styles.getPropertyValue(key).trim() : key).join("|");
}

function mermaidThemeVariables() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const css = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  const isDark = root.dataset.theme === "dark" || root.classList.contains("dark");
  const background = css("--background", isDark ? "#0f1318" : "#fbfcfe");
  const foreground = css("--foreground", isDark ? "#e7ecf2" : "#20242a");
  const muted = css("--muted", isDark ? "#202832" : "#edf1f6");
  const mutedForeground = css("--muted-foreground", isDark ? "#9ba7b4" : "#68717d");
  const border = css("--border", isDark ? "#2a3440" : "#dce3eb");
  const primary = css("--primary", isDark ? "#8ab8ec" : "#3b6ea8");
  const primaryForeground = css("--primary-foreground", isDark ? "#10151b" : "#ffffff");

  return {
    darkMode: isDark,
    background,
    primaryColor: muted,
    primaryTextColor: foreground,
    primaryBorderColor: border,
    lineColor: mutedForeground,
    secondaryColor: background,
    tertiaryColor: muted,
    mainBkg: muted,
    nodeBorder: border,
    clusterBkg: background,
    clusterBorder: border,
    titleColor: foreground,
    edgeLabelBackground: background,
    textColor: foreground,
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif",
    noteBkg: muted,
    noteTextColor: foreground,
    noteBorderColor: border,
    actorBkg: muted,
    actorBorder: border,
    actorTextColor: foreground,
    signalColor: foreground,
    signalTextColor: foreground,
    labelBoxBkgColor: background,
    labelBoxBorderColor: border,
    labelTextColor: foreground,
    loopTextColor: foreground,
    activationBkgColor: primary,
    activationBorderColor: primary,
    sequenceNumberColor: primaryForeground
  };
}

function sanitizeDomId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function ReasoningBlock({ text, summary = true }: { text: string; summary?: boolean }) {
  return (
    <details className="reasoning-block" open={summary}>
      <summary>思考内容</summary>
      <div className="reasoning-block-body">
        <MarkdownText text={text} />
      </div>
    </details>
  );
}

function SteerInline({ item }: { item: Extract<AssistantPart, { type: "steer" }> }) {
  return (
    <div className={`assistant-steer-inline ${item.status}`}>
      <span className="assistant-steer-line" aria-hidden="true" />
      <span className="assistant-steer-text">{item.text}</span>
      <small>{steerStatusLabel(item.status)}</small>
    </div>
  );
}

function MessageActions({
  message,
  alignRight,
  onRollback,
  onFork
}: {
  message: UiMessage;
  alignRight: boolean;
  onRollback?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const canCopy = message.text.trim().length > 0;

  async function copy() {
    if (!canCopy) return;
    await navigator.clipboard.writeText(message.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className={`message-actions ${alignRight ? "right" : "left"}`}>
      <button type="button" title="复制" aria-label="复制消息" disabled={!canCopy} onClick={() => void copy()}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {message.role === "user" ? (
        <button type="button" title="回退到这轮" aria-label="回退到这轮" disabled={!onRollback} onClick={() => onRollback?.(message.id)}>
          <Undo2 size={14} />
        </button>
      ) : null}
      {message.role === "assistant" ? (
        <button type="button" title="从这里创建分支会话" aria-label="创建分支会话" disabled={!onFork} onClick={() => onFork?.(message.id)}>
          <GitBranch size={14} />
        </button>
      ) : null}
    </div>
  );
}

function QueuedSteerStack({ items, onRemove }: { items: QueuedSteerMessage[]; onRemove?: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="steer-queue">
      {items.map((item) => (
        <div className={`steer-queue-item ${item.status}`} key={item.id}>
          <span>{item.text}</span>
          <small>{steerStatusLabel(item.status)}</small>
          {item.status !== "sent" ? (
            <button type="button" onClick={() => onRemove?.(item.id)} aria-label="移除引导消息">
              ×
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function mergeSteerMessages(primary: QueuedSteerMessage[] | undefined, secondary: QueuedSteerMessage[] | undefined): QueuedSteerMessage[] {
  const byId = new Map<string, QueuedSteerMessage>();
  for (const item of [...(primary ?? []), ...(secondary ?? [])]) {
    const existingKey = [...byId.entries()].find(([, existing]) => existing.id === item.id || existing.text === item.text)?.[0];
    const key = existingKey ?? item.id;
    byId.set(key, { ...byId.get(key), ...item });
  }
  return [...byId.values()];
}

function steerStatusLabel(status: QueuedSteerMessage["status"]): string {
  if (status === "sent") return "已追加";
  if (status === "failed") return "追加失败";
  return "待发送";
}

function RunningTurnBar({ message }: { message: UiMessage }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedMs = Math.max(0, now - (message.turnStartedAt ?? message.createdAt ?? now));

  return (
    <div className="turn-runtime running">
      <span className="turn-runtime-line" />
      <span>{message.synthetic === "manualCompact" ? "正在压缩上下文" : "Codex 工作中"} · {formatDuration(elapsedMs)}</span>
    </div>
  );
}

function MessageStats({ message }: { message: UiMessage }) {
  const durationMs = message.turnDurationMs ?? durationBetween(message.turnStartedAt, message.turnCompletedAt);
  const inputTokens = message.tokenUsage?.inputTokens;
  const cachedInputTokens = message.tokenUsage?.cachedInputTokens;
  const outputTokens = message.tokenUsage?.outputTokens;
  const speed = outputTokens && durationMs > 0 ? outputTokens / (durationMs / 1000) : undefined;
  if (!durationMs && inputTokens == null && outputTokens == null) return null;

  return (
    <div className="message-stats">
      {inputTokens != null ? (
        <span title={cachedInputTokens ? `包含 ${formatTokenCount(cachedInputTokens)} cached tokens` : undefined}>
          <ArrowUp size={12} />
          {formatTokenCount(inputTokens)} tokens
        </span>
      ) : null}
      {outputTokens != null ? (
        <span>
          <ArrowDown size={12} />
          {formatTokenCount(outputTokens)} tokens
        </span>
      ) : null}
      {speed != null ? (
        <span>
          <Gauge size={12} />
          {speed.toFixed(2)} tok/s
        </span>
      ) : null}
      {durationMs ? (
        <span>
          <Clock3 size={12} />
          {formatDuration(durationMs)}
        </span>
      ) : null}
    </div>
  );
}

interface QuickJumpHandle {
  syncActiveMessage: () => void;
}

const QuickJump = forwardRef<QuickJumpHandle, {
  turns: MessageTurn[];
  visibleTurnStartIndex: number;
  totalTurnCount: number;
  onBeforeJump: () => void;
  isMobileLayout: boolean;
  mobileJumpRailOpen: boolean;
  onRequestCollapseMobileJumpRail?: () => void;
}>(function QuickJump({
  turns,
  visibleTurnStartIndex,
  totalTurnCount,
  onBeforeJump,
  isMobileLayout,
  mobileJumpRailOpen,
  onRequestCollapseMobileJumpRail
}, ref) {
  const allItems = useMemo(() => turns.map((turn, index) => {
    const userMessage = turn.messages.find((message) => message.role === "user") ?? turn.messages[0];
    return userMessage ? {
      id: userMessage.id,
      role: userMessage.role,
      globalIndex: visibleTurnStartIndex + index + 1,
      preview: previewText(userMessage)
    } : null;
  }).filter((item): item is { id: string; role: UiMessage["role"]; globalIndex: number; preview: string } => Boolean(item)), [turns, visibleTurnStartIndex]);
  const items = useMemo(() => compressJumpItems(allItems, MAX_JUMP_ITEMS), [allItems]);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const activeIndex = activeMessageId ? allItems.find((item) => item.id === activeMessageId)?.globalIndex ?? 0 : 0;

  const resolveActiveMessageId = useCallback(() => {
    const scrollElement = document.querySelector<HTMLElement>(".conversation-scroll");
    if (!scrollElement || allItems.length === 0) return allItems[allItems.length - 1]?.id ?? null;

    const scrollTopLine = scrollElement.getBoundingClientRect().top + 24;
    let activeId = allItems[0]?.id ?? null;

    for (const item of allItems) {
      const anchor = document.getElementById(`message-${item.id}`);
      if (!anchor) continue;
      if (anchor.getBoundingClientRect().top <= scrollTopLine) {
        activeId = item.id;
      } else {
        break;
      }
    }

    return activeId;
  }, [allItems]);

  const syncActiveMessage = useCallback(() => {
    const nextActiveId = resolveActiveMessageId();
    setActiveMessageId((current) => current === nextActiveId ? current : nextActiveId);
  }, [resolveActiveMessageId]);

  useImperativeHandle(ref, () => ({ syncActiveMessage }), [syncActiveMessage]);

  useEffect(() => {
    if (allItems.length <= 1) {
      setActiveMessageId(null);
      return;
    }

    const scrollElement = document.querySelector<HTMLElement>(".conversation-scroll");
    let frameId: number | null = null;
    const updateActive = () => {
      frameId = null;
      syncActiveMessage();
    };
    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateActive);
    };

    updateActive();
    scrollElement?.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);

    return () => {
      scrollElement?.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
    };
  }, [allItems.length, syncActiveMessage]);

  if (allItems.length <= 1) return null;

  function jumpToMessage(messageId: string) {
    const anchor = document.getElementById(`message-${messageId}`);
    if (!anchor) return;
    onBeforeJump();
    onRequestCollapseMobileJumpRail?.();
    setActiveMessageId(messageId);
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className={`conversation-jump-rail ${isMobileLayout ? "mobile" : ""} ${mobileJumpRailOpen ? "open" : "closed"}`} aria-label="消息快速跳转">
      <div className="conversation-jump-items">
        {items.map((item, index) => {
          const originalIndex = item.globalIndex;
          const roleLabel = "用户";
          const isActive = activeMessageId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`conversation-jump-item ${item.role} ${isActive ? "active" : ""}`}
              aria-label={`跳转到第 ${originalIndex + 1} 条${roleLabel}消息`}
              title={`第 ${originalIndex + 1} 条${roleLabel}消息`}
              onClick={() => jumpToMessage(item.id)}
            >
              <span className="conversation-jump-line" />
              <span className="conversation-jump-dot" />
              <span className="conversation-jump-preview" role="tooltip">
                <span>第 {originalIndex}/{totalTurnCount} 轮 · {roleLabel}</span>
                <strong>{item.preview.trim() || "无可预览内容"}</strong>
              </span>
            </button>
          );
        })}
        <div className="conversation-jump-count">
          {activeIndex || visibleTurnStartIndex + 1}/{totalTurnCount} 轮
        </div>
      </div>
    </nav>
  );
});

interface MessageTurn {
  id: string;
  messages: UiMessage[];
}

interface ScrollRestoreSnapshot {
  anchorId?: string;
  anchorTop?: number;
  previousHeight: number;
  previousTop: number;
}

function captureScrollRestore(scrollElement: HTMLElement, target: "top" | "center"): ScrollRestoreSnapshot {
  const anchor = findScrollAnchor(scrollElement, target);
  return {
    anchorId: anchor?.id,
    anchorTop: anchor?.top,
    previousHeight: scrollElement.scrollHeight,
    previousTop: scrollElement.scrollTop
  };
}

function restoreScrollPosition(scrollElement: HTMLElement, snapshot: ScrollRestoreSnapshot) {
  if (snapshot.anchorId && snapshot.anchorTop != null) {
    const anchor = document.getElementById(snapshot.anchorId);
    if (anchor) {
      const nextTop = anchor.getBoundingClientRect().top;
      scrollElement.scrollTop += nextTop - snapshot.anchorTop;
      return;
    }
  }
  scrollElement.scrollTop = scrollElement.scrollHeight - snapshot.previousHeight + snapshot.previousTop;
}

function findScrollAnchor(scrollElement: HTMLElement, target: "top" | "center"): { id: string; top: number } | null {
  const messages = Array.from(scrollElement.querySelectorAll<HTMLElement>(".conversation-message[id]"));
  if (!messages.length) return null;
  const scrollRect = scrollElement.getBoundingClientRect();
  const targetY = target === "top" ? scrollRect.top + 64 : scrollRect.top + scrollRect.height / 2;
  let best: { id: string; top: number; distance: number } | null = null;
  for (const message of messages) {
    const rect = message.getBoundingClientRect();
    if (rect.bottom < scrollRect.top || rect.top > scrollRect.bottom) continue;
    const distance = Math.abs(rect.top - targetY);
    if (!best || distance < best.distance) {
      best = { id: message.id, top: rect.top, distance };
    }
  }
  if (!best) {
    const fallback = target === "top" ? messages[0] : messages[messages.length - 1];
    if (!fallback) return null;
    return { id: fallback.id, top: fallback.getBoundingClientRect().top };
  }
  return { id: best.id, top: best.top };
}

function groupMessagesByTurn(messages: UiMessage[]): MessageTurn[] {
  const turns: MessageTurn[] = [];
  let current: MessageTurn | null = null;

  messages.forEach((message, index) => {
    const startsTurn = message.role === "user" || !current;
    if (startsTurn) {
      current = { id: message.turnId ?? message.id ?? `turn-${index}`, messages: [] };
      turns.push(current);
    }
    current?.messages.push(message);
  });

  return turns;
}

function compressJumpItems<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  const result: T[] = [];
  const used = new Set<number>();
  for (let index = 0; index < maxItems; index += 1) {
    const sourceIndex = Math.round(index * (items.length - 1) / (maxItems - 1));
    if (!used.has(sourceIndex)) {
      used.add(sourceIndex);
      result.push(items[sourceIndex]!);
    }
  }
  return result;
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(timestamp);
}

function previewText(message: UiMessage): string {
  const text = message.text.replace(/\s+/g, " ").trim();
  if (text) return text.length > 36 ? `${text.slice(0, 36)}...` : text;
  if (message.assistantParts?.some((part) => part.type === "tool")) return `${message.assistantParts.filter((part) => part.type === "tool").length} 个工具调用`;
  if (message.attachments?.length) return `${message.attachments.length} 个附件`;
  if (message.images?.length) return `${message.images.length} 个附件`;
  return message.isStreaming ? "生成中" : "空消息";
}

function statusLabel(status: UiToolCall["status"]): string {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "inProgress") return "运行中";
  if (status === "cancelled") return "已取消";
  return "工具";
}

function statusClass(status: UiToolCall["status"]): string {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "inProgress") return "running";
  return "neutral";
}

function toolTitle(toolCall: UiToolCall): string {
  if (toolCall.type === "fileChange" && toolCall.changes && toolCall.changes.length > 1) {
    return `修改文件 · ${toolCall.changes.length} 个文件`;
  }
  const fallback = toolTypeLabel(toolCall.type);
  const normalized = (toolCall.title || toolCall.command || fallback).replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function toolTypeLabel(type: string): string {
  if (type === "commandExecution") return "执行命令";
  if (type === "fileChange") return "修改文件";
  if (type === "mcpToolCall") return "MCP 工具";
  if (type === "dynamicToolCall") return "自定义工具";
  if (type === "webSearch") return "网络搜索";
  if (type === "imageView") return "查看图片";
  if (type === "imageGeneration") return "生成图片";
  if (type === "plan") return "计划";
  return "工具";
}

function toolIcon(type: string): string {
  if (type === "commandExecution") return "/icons/shell-command.svg";
  if (type === "fileChange") return "/icons/file-change.svg";
  if (type === "mcpToolCall" || type === "dynamicToolCall") return "/icons/tool-call.svg";
  if (type === "webSearch") return "/icons/web-search.svg";
  if (type === "imageView" || type === "imageGeneration") return "/icons/image-generation.svg";
  if (type === "plan") return "/icons/list-todo.svg";
  return "/icons/tool-call.svg";
}

function toolDetailItems(toolCall: UiToolCall): Array<{ label: string; value: string; kind?: "code" | "pre" | "diff" }> {
  const items: Array<{ label: string; value: string; kind?: "code" | "pre" | "diff" }> = [];
  if (toolCall.cwd) items.push({ label: "目录", value: toolCall.cwd, kind: "code" });
  if (toolCall.command) items.push({ label: "命令", value: toolCall.command, kind: "pre" });
  if (toolCall.server) items.push({ label: "服务", value: toolCall.server, kind: "code" });
  if (toolCall.toolName) items.push({ label: "工具", value: toolCall.toolName, kind: "code" });
  if (toolCall.type !== "fileChange" && toolCall.changes?.length) {
    items.push({ label: "文件", value: toolCall.changes.map(formatFileChange).join("\n"), kind: "pre" });
    const diff = toolCall.changes.map((change) => change.diff?.trim()).filter(Boolean).join("\n\n");
    if (diff) items.push({ label: "Diff", value: diff, kind: "diff" });
  }
  if (toolCall.arguments !== undefined) items.push({ label: "参数", value: formatJsonValue(toolCall.arguments), kind: "pre" });
  if (toolCall.result !== undefined) items.push({ label: "结果", value: formatJsonValue(toolCall.result), kind: "pre" });
  if (toolCall.error !== undefined && toolCall.error !== null) items.push({ label: "错误", value: formatJsonValue(toolCall.error), kind: "pre" });
  if (toolCall.exitCode != null) items.push({ label: "退出码", value: String(toolCall.exitCode), kind: "code" });
  return items;
}

function formatFileChange(change: NonNullable<UiToolCall["changes"]>[number]): string {
  const kind = change.kind === "add" ? "新增" : change.kind === "delete" ? "删除" : change.kind === "update" ? "更新" : "变更";
  return change.movePath ? `${kind} ${change.path} -> ${change.movePath}` : `${kind} ${change.path}`;
}

function shortPathName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

function formatJsonValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function durationBetween(startedAt?: number, completedAt?: number): number {
  if (!startedAt || !completedAt || completedAt < startedAt) return 0;
  return completedAt - startedAt;
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeLocalMarkdownLinks(text: string): string {
  return text.replace(/\]\(([A-Za-z]:\/[^)\s]+)\)/g, "]($1)");
}

function isFileTreeLanguage(language?: string): boolean {
  return Boolean(language && ["tree", "filetree", "files", "filesystem"].includes(language));
}

function diffLineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "diff-file";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-remove";
  return "diff-context";
}

function codeDisplayRows(code: string, highlighted: string[]) {
  return code.split("\n").map((line, index) => ({
    key: index,
    line,
    lineNumber: String(index + 1),
    className: "",
    html: highlighted[index] ?? escapeHtml(line)
  }));
}

function diffDisplayRows(code: string, highlighted: string[]) {
  let oldLine = 0;
  let newLine = 0;
  const rows: Array<{ key: number; line: string; lineNumber?: string; className: string; html: string }> = [];

  code.split("\n").forEach((line, index) => {
    const hunk = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return;
    }

    const className = diffLineClass(line);
    let lineNumber = "";
    if (line.startsWith("+++") || line.startsWith("---")) {
      lineNumber = "";
    } else if (line.startsWith("+")) {
      lineNumber = String(newLine);
      newLine += 1;
    } else if (line.startsWith("-")) {
      lineNumber = String(oldLine);
      oldLine += 1;
    } else {
      lineNumber = String(newLine);
      oldLine += 1;
      newLine += 1;
    }

    rows.push({
      key: index,
      line,
      lineNumber,
      className,
      html: highlighted[index] ?? escapeHtml(line)
    });
  });

  return rows;
}

function parseFileTreeLine(line: string): { depth: number; kind: "folder" | "file"; name: string } {
  const normalized = line.replace(/\t/g, "  ");
  const cleaned = normalized.replace(/[│├└─]/g, " ");
  const leading = cleaned.match(/^\s*/)?.[0].length ?? 0;
  const depth = Math.max(0, Math.floor(leading / 2));
  const name = normalized
    .replace(/^[\s│]*(?:├──|└──|├─|└─|--|-)?\s*/, "")
    .trim();
  const kind = name.endsWith("/") || !/\.[^./\\]+$/.test(name) ? "folder" : "file";
  return { depth, kind, name: name.replace(/\/$/, "") || line.trim() };
}

function stabilizeStreamingMarkdown(text: string): string {
  const fenceMatches = text.match(/```/g);
  if (fenceMatches && fenceMatches.length % 2 === 1) return `${text}\n\n\`\`\``;
  return text;
}

function highlightCode(code: string, language?: string): string[] {
  const escapedLines = code.split("\n").map(escapeHtml);
  try {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value.split("\n");
    }
    return escapedLines;
  } catch {
    return escapedLines;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hashText(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

