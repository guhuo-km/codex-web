import { ArrowDown, ArrowUp, Check, Clock3, Copy, FileText, Gauge, GitBranch, MessageSquare, Minus, PanelRightClose, PanelRightOpen, Plus, RotateCcw, SquareTerminal, Undo2, X } from "lucide-react";
import { forwardRef, memo, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type HTMLAttributes, type ReactNode, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import hljs from "highlight.js/lib/common";
import "katex/dist/katex.min.css";
import "@xterm/xterm/css/xterm.css";
import { terminalWsUrl } from "../api";
import { formatDuration, formatTokenCount } from "../display-format";
import { diffStatsForToolCall, fileChangeViews } from "../file-change-display";
import { appendTurnWindow, followLatestTurnWindow, latestTurnWindow, normalizeTurnWindow, prependTurnWindow, type TurnWindow } from "../turn-window";
import type { QueuedSteerMessage, TaskSummary, ThreadGoal, ToolCardFrameKey, ToolCardFrameSettings, ToolGroupCollapseMode, UiAgentEvent, UiMessage, UiSubagentCall, UiThread, UiToolCall } from "../types";

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
  toolCardFrames?: ToolCardFrameSettings;
  renderUserMessagesAsMarkdown?: boolean;
  historyCacheTurnLimit?: number;
  runningTask?: TaskSummary;
  goal?: ThreadGoal | null;
  onRollbackMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string) => void;
  onCreateGoal?: (objective: string) => void | Promise<void>;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onClearGoal?: () => void | Promise<void>;
  subagentThreads?: UiThread[];
  activeThreadId?: string | null;
  onSelectSubagent?: (thread: UiThread) => void;
  isMobileLayout?: boolean;
  mobileRightDrawerOpen?: boolean;
  onToggleMobileRightDrawer?: () => void;
  onRequestCloseMobileRightDrawer?: () => void;
}

export const isMemoizedChatPane = true;

export const ChatPane = memo(function ChatPane({
  thread,
  isGenerating = false,
  model,
  toolGroupCollapseMode = "alwaysExpanded",
  toolCardFrames,
  renderUserMessagesAsMarkdown = false,
  historyCacheTurnLimit = 60,
  runningTask,
  goal,
  onRollbackMessage,
  onForkMessage,
  onCreateGoal,
  onPauseGoal,
  onResumeGoal,
  onClearGoal,
  subagentThreads = [],
  activeThreadId,
  onSelectSubagent,
  isMobileLayout = false,
  mobileRightDrawerOpen = false,
  onToggleMobileRightDrawer,
  onRequestCloseMobileRightDrawer
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
    if (!mobileRightDrawerOpen) return;
    userScrollIntentRef.current = false;
    suppressProgrammaticScroll();
  }, [mobileRightDrawerOpen]);

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
    if (isMobileLayout && mobileRightDrawerOpen && userScrollIntentRef.current) {
      onRequestCloseMobileRightDrawer?.();
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
    <main className={`chat-pane ${mobileRightDrawerOpen ? "right-drawer-open" : ""}`}>
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
                toolCardFrames={toolCardFrames}
                subagentThreads={subagentThreads}
                renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
                onSelectSubagent={onSelectSubagent}
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
                  toolCardFrames={toolCardFrames}
                  subagentThreads={subagentThreads}
                  renderUserMessagesAsMarkdown={renderUserMessagesAsMarkdown}
                  onSelectSubagent={onSelectSubagent}
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
            {visibleTurns.length > 1 && !isMobileLayout ? (
              <QuickJump
                ref={jumpRailRef}
                turns={visibleTurns}
                visibleTurnStartIndex={visibleTurnStartIndex}
                totalTurnCount={turns.length}
                onBeforeJump={suppressProgrammaticScroll}
              />
            ) : null}
          </div>
        )}
      </div>
      {thread ? (
        <RightDrawer
          turns={visibleTurns}
          cwd={thread.cwd}
          visibleTurnStartIndex={visibleTurnStartIndex}
          totalTurnCount={turns.length}
          open={mobileRightDrawerOpen}
          onToggle={onToggleMobileRightDrawer}
          onBeforeJump={suppressProgrammaticScroll}
          onRequestClose={onRequestCloseMobileRightDrawer}
          showJumpNavigation={isMobileLayout && visibleTurns.length > 1}
          goal={goal}
          onCreateGoal={onCreateGoal}
          onPauseGoal={onPauseGoal}
          onResumeGoal={onResumeGoal}
          onClearGoal={onClearGoal}
          subagentThreads={subagentThreads}
          activeThreadId={activeThreadId}
          onSelectSubagent={onSelectSubagent}
        />
      ) : null}
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
  toolCardFrames,
  subagentThreads,
  renderUserMessagesAsMarkdown,
  onSelectSubagent,
  onRollbackMessage,
  onForkMessage,
  onPreviewImage
}: {
  message: UiMessage;
  isLast: boolean;
  model?: string;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  toolCardFrames?: ToolCardFrameSettings;
  subagentThreads?: UiThread[];
  renderUserMessagesAsMarkdown: boolean;
  onSelectSubagent?: (thread: UiThread) => void;
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
  const steerItems = isUser ? [] : mergeSteerMessages(message.steerMessages, []);
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
            <AssistantParts
              parts={message.assistantParts ?? []}
              toolGroupCollapseMode={toolGroupCollapseMode}
              toolCardFrames={toolCardFrames}
              subagentThreads={subagentThreads}
              isStreaming={Boolean(message.isStreaming)}
              onSelectSubagent={onSelectSubagent}
            />
          ) : hasText ? (
            isUser ? (
              <div className="user-message-bubble">
                {renderUserMessagesAsMarkdown ? <MarkdownText text={message.text} className="user-message-markdown" /> : <UserText text={message.text} />}
              </div>
            ) : <MarkdownText text={message.text} streaming={message.isStreaming} />
          ) : null}
        </div>
      </div>
      {(message.isStreaming || message.statusText === "已结束") && !isUser ? (
        <>
          <RunningTurnBar message={message} />
          {!hasSteerParts ? <QueuedSteerStack items={steerItems} /> : null}
        </>
      ) : (hasText || hasParts || message.images?.length || message.attachments?.length || isLast) ? (
        <>
          <MessageActions
            message={message}
            alignRight={isUser}
            onRollback={isUser ? onRollbackMessage : undefined}
            onFork={!isUser ? onForkMessage : undefined}
          />
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

function AssistantParts({
  parts,
  toolGroupCollapseMode,
  toolCardFrames,
  subagentThreads,
  isStreaming,
  onSelectSubagent
}: {
  parts: NonNullable<UiMessage["assistantParts"]>;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  toolCardFrames?: ToolCardFrameSettings;
  subagentThreads?: UiThread[];
  isStreaming: boolean;
  onSelectSubagent?: (thread: UiThread) => void;
}) {
  const [openCallId, setOpenCallId] = useState<string | null>(null);
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
        if (group.kind === "agentEvent") return <AgentEventBlock key={group.part.id} event={group.part.event} />;
        if (group.parts.length === 1) {
          return renderCallPart(group.parts[0]!);
        }
        const defaultCollapsed = toolGroupCollapseMode === "alwaysCollapsed" || (toolGroupCollapseMode === "collapseAfterComplete" && !isStreaming);
        const collapsed = defaultCollapsed ? !toggledToolGroups.has(group.id) : toggledToolGroups.has(group.id);
        return (
          <div className={`tool-call-group ${collapsed ? "collapsed" : ""}`} key={group.id}>
            <button className="tool-call-group-toggle" type="button" onClick={() => toggleToolGroup(group.id)} aria-expanded={!collapsed}>
              <span className="tool-call-group-chevron" aria-hidden="true" />
              <span>{callGroupSummary(group.parts)}</span>
            </button>
            <div className="tool-call-group-body">
              {collapsed ? null : group.parts.map((part) => renderCallPart(part))}
            </div>
          </div>
        );
      })}
    </div>
  );

  function renderCallPart(part: CallPart) {
    if (part.type === "subagent") {
      const targetThread = subagentTargetThread(part.subagent, subagentThreads ?? []);
      const detailItems = subagentDetailItems(part.subagent);
      return (
        <CallCard
          key={part.id}
          framed={isToolCardFrameEnabled(toolCardFrames, "subagent")}
          status={subagentStatus(part.subagent)}
          open={openCallId === part.id}
          onToggle={() => setOpenCallId((current) => current === part.id ? null : part.id)}
          iconStyle={{ "--tool-icon": 'url("/icons/agent.svg")' } as CSSProperties}
          title={subagentTitle(part.subagent)}
          subtitle={subagentSubtitle(part.subagent)}
          trailingAction={targetThread && onSelectSubagent ? (
            <button
              className="tool-call-trailing-action"
              type="button"
              onClick={() => onSelectSubagent(targetThread)}
              aria-label={`打开子代理会话 ${targetThread.id}`}
              title={`进入子代理会话 ${targetThread.id}`}
            >
              <PanelRightOpen size={14} />
            </button>
          ) : null}
        >
          {detailItems.map((item) => (
            <div className="tool-call-kv" key={item.label}>
              <span>{item.label}</span>
              {item.kind === "code" ? <code>{item.value}</code> : <pre>{item.value}</pre>}
            </div>
          ))}
        </CallCard>
      );
    }

    return (
      <ToolCallCard
        key={part.id}
        toolCall={part.toolCall}
        framed={isToolCardFrameEnabled(toolCardFrames, toolCardFrameKey(part.toolCall))}
        open={openCallId === part.id}
        onToggle={() => setOpenCallId((current) => current === part.id ? null : part.id)}
      />
    );
  }
}

function ToolCallCard({ toolCall, framed, open, onToggle }: { toolCall: UiToolCall; framed: boolean; open: boolean; onToggle: () => void }) {
  const output = toolCall.aggregatedOutput?.trim();
  const detailItems = toolDetailItems(toolCall);
  const fileChangeStats = toolCall.type === "fileChange" ? diffStatsForToolCall(toolCall) : null;
  const fileChanges = toolCall.type === "fileChange" ? fileChangeViews(toolCall) : [];
  const subtitle = (
    <>
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
    </>
  );

  return (
    <CallCard
      framed={framed}
      status={toolCall.status}
      open={open}
      onToggle={onToggle}
      iconStyle={{ "--tool-icon": `url("${toolIcon(toolCall.type)}")` } as CSSProperties}
      eyebrow={toolCall.commandExplanation}
      title={toolTitle(toolCall)}
      subtitle={subtitle}
    >
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
    </CallCard>
  );
}

function CallCard({
  framed,
  status,
  open,
  onToggle,
  iconStyle,
  eyebrow,
  title,
  subtitle,
  trailingAction,
  children
}: {
  framed: boolean;
  status?: string;
  open: boolean;
  onToggle: () => void;
  iconStyle: CSSProperties;
  eyebrow?: string;
  title: string;
  subtitle: ReactNode;
  trailingAction?: ReactNode;
  children: ReactNode;
}) {
  const cardClassName = [
    "tool-call-card",
    framed ? "framed" : "unframed",
    statusClass(status),
    open ? "open" : undefined
  ].filter(Boolean).join(" ");

  return (
    <section className={cardClassName}>
      <div className="tool-call-header">
        <button className="tool-call-summary" type="button" onClick={onToggle} aria-expanded={open}>
          <span className="tool-call-icon" aria-hidden="true" style={iconStyle} />
          <span className="tool-call-main">
            {eyebrow ? <span className="tool-call-explanation">{eyebrow}</span> : null}
            <span className="tool-call-title" title={title}>{title}</span>
            <span className="tool-call-subtitle">{subtitle}</span>
          </span>
        </button>
        {trailingAction}
      </div>
      <div className={`tool-call-detail ${open ? "open" : "closed"}`} aria-hidden={!open}>
        <div className="tool-call-detail-inner">
          {children}
        </div>
      </div>
    </section>
  );
}

type AssistantPart = NonNullable<UiMessage["assistantParts"]>[number];
type CallPart = Extract<AssistantPart, { type: "tool" | "subagent" }>;

type AssistantPartGroup =
  | { kind: "text"; part: Extract<AssistantPart, { type: "text" }> }
  | { kind: "reasoning"; part: Extract<AssistantPart, { type: "reasoning" }> }
  | { kind: "steer"; part: Extract<AssistantPart, { type: "steer" }> }
  | { kind: "agentEvent"; part: Extract<AssistantPart, { type: "agentEvent" }> }
  | { kind: "calls"; id: string; parts: CallPart[] };

function groupAssistantParts(parts: NonNullable<UiMessage["assistantParts"]>): AssistantPartGroup[] {
  const groups: AssistantPartGroup[] = [];
  let callBuffer: CallPart[] = [];

  function flushCalls() {
    if (!callBuffer.length) return;
    groups.push({
      kind: "calls",
      id: `calls-${callBuffer[0]?.id ?? groups.length}-${callBuffer.length}`,
      parts: callBuffer
    });
    callBuffer = [];
  }

  for (const part of parts) {
    if (part.type === "tool" || part.type === "subagent") {
      callBuffer.push(part);
    } else if (part.type === "reasoning") {
      flushCalls();
      groups.push({ kind: "reasoning", part });
    } else if (part.type === "steer") {
      flushCalls();
      groups.push({ kind: "steer", part });
    } else if (part.type === "agentEvent") {
      flushCalls();
      groups.push({ kind: "agentEvent", part });
    } else {
      flushCalls();
      groups.push({ kind: "text", part });
    }
  }
  flushCalls();
  return groups;
}

function subagentTitle(subagent: UiSubagentCall): string {
  const label = subagentAgentLabel(subagent);
  const action = subagent.type === "subAgentActivity"
    ? subagentActivityLabel(subagent.kind)
    : subagentToolLabel(subagent.tool);
  return label ? `${action} · ${label}` : action;
}

function subagentSubtitle(subagent: UiSubagentCall): string {
  const parts = [
    subagent.prompt ? compactWhitespace(subagent.prompt) : "",
    subagentStatusLabel(subagentStatus(subagent))
  ].filter(Boolean);
  return parts.join(" · ");
}

function subagentStatus(subagent: UiSubagentCall): string | undefined {
  if (subagent.status) return subagent.status;
  const states = Object.values(subagent.agentsStates ?? {});
  if (states.some((state) => state.status === "errored" || state.status === "notFound")) return "failed";
  if (states.some((state) => state.status === "running" || state.status === "pendingInit")) return "inProgress";
  if (states.some((state) => state.status === "completed" || state.status === "shutdown")) return "completed";
  if (subagent.kind === "interrupted") return "failed";
  if (subagent.kind === "started" || subagent.kind === "interacted") return "inProgress";
  return undefined;
}

function subagentAgentLabel(subagent: UiSubagentCall): string {
  const ids = [
    subagent.agentThreadId,
    ...(subagent.receiverThreadIds ?? []),
    ...Object.keys(subagent.agentsStates ?? {}),
    looksLikeThreadId(subagent.id) ? subagent.id : undefined
  ].filter((value, index, values): value is string => Boolean(value && values.indexOf(value) === index));
  return ids.join("、");
}

function subagentTargetThread(subagent: UiSubagentCall, threads: UiThread[]): UiThread | undefined {
  const ids = [
    subagent.agentThreadId,
    ...(subagent.receiverThreadIds ?? []),
    ...Object.keys(subagent.agentsStates ?? {}),
    looksLikeThreadId(subagent.id) ? subagent.id : undefined
  ].filter((value, index, values): value is string => Boolean(value && values.indexOf(value) === index));
  return ids.map((id) => threads.find((thread) => thread.id === id)).find((thread): thread is UiThread => Boolean(thread));
}

function subagentToolLabel(tool: string | undefined): string {
  if (tool === "spawnAgent") return "启动子代理";
  if (tool === "sendInput") return "引导子代理";
  if (tool === "resumeAgent") return "继续子代理";
  if (tool === "wait") return "等待子代理";
  if (tool === "closeAgent") return "关闭子代理";
  return "子代理调用";
}

function subagentActivityLabel(kind: string | undefined): string {
  if (kind === "started") return "子代理已启动";
  if (kind === "interacted") return "子代理交互";
  if (kind === "interrupted") return "子代理已中断";
  return "子代理活动";
}

function subagentStatusLabel(status: string | undefined): string {
  if (status === "completed" || status === "shutdown") return "已完成";
  if (status === "failed" || status === "errored" || status === "notFound") return "失败";
  if (status === "interrupted") return "已中断";
  if (status === "inProgress" || status === "running" || status === "pendingInit") return "运行中";
  return status ?? "";
}

function looksLikeThreadId(value: string | undefined): value is string {
  return Boolean(value && /^019[0-9a-f-]{8,}$/i.test(value));
}

function subagentDetailItems(subagent: UiSubagentCall): Array<{ label: string; value: string; kind?: "code" }> {
  return [
    { label: "ID", value: subagent.id, kind: "code" },
    subagent.tool ? { label: "动作", value: subagentToolLabel(subagent.tool), kind: "code" as const } : null,
    subagent.kind ? { label: "活动", value: subagentActivityLabel(subagent.kind), kind: "code" as const } : null,
    subagent.agentThreadId ? { label: "子代理线程", value: subagent.agentThreadId, kind: "code" as const } : null,
    subagent.receiverThreadIds?.length ? { label: "接收线程", value: subagent.receiverThreadIds.join("\n"), kind: "code" as const } : null,
    subagent.senderThreadId ? { label: "发起线程", value: subagent.senderThreadId, kind: "code" as const } : null,
    subagent.model ? { label: "模型", value: subagent.model, kind: "code" as const } : null,
    subagent.reasoningEffort ? { label: "推理强度", value: subagent.reasoningEffort, kind: "code" as const } : null,
    subagent.prompt ? { label: "任务", value: subagent.prompt } : null,
    subagent.agentsStates ? { label: "状态", value: formatJsonValue(subagent.agentsStates) } : null,
    { label: "详情", value: formatJsonValue(subagent.details) }
  ].filter((item): item is { label: string; value: string; kind?: "code" } => Boolean(item));
}

function compactWhitespace(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > 96 ? `${text.slice(0, 96)}...` : text;
}

function callGroupSummary(parts: CallPart[]): string {
  const changedFiles = new Set<string>();
  let webSearches = 0;
  let commands = 0;
  let mcpCalls = 0;
  let subagents = 0;

  for (const part of parts) {
    if (part.type === "subagent") {
      subagents += 1;
      continue;
    }
    const toolCall = part.toolCall;
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
    mcpCalls ? `调用了 ${mcpCalls} 次 MCP 工具` : "",
    subagents ? `调用了 ${subagents} 个子代理` : ""
  ].filter(Boolean);

  return segments.length ? segments.join("，") : `进行了 ${parts.length} 次调用`;
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

function AgentEventBlock({ event }: { event: UiAgentEvent }) {
  const [open, setOpen] = useState(false);
  const details = event.details === undefined ? "" : formatJsonValue(event.details);
  const summaryContent = (
    <>
      <div className="agent-event-summary-main">
        <div className="agent-event-summary-line">
          <span className="agent-event-title">{event.title}</span>
          {event.createdAt ? <time>{formatTimestamp(event.createdAt)}</time> : null}
        </div>
        {event.message ? <div className="agent-event-message">{event.message}</div> : null}
      </div>
      {details ? <span className="agent-event-chevron" aria-hidden="true">›</span> : null}
    </>
  );
  return (
    <section className={`agent-event-block ${event.tone}`}>
      {details ? (
        <div className={`agent-event-disclosure ${open ? "open" : ""}`}>
          <button className="agent-event-summary" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
            {summaryContent}
          </button>
          {open ? <pre>{details}</pre> : null}
        </div>
      ) : (
        <div className="agent-event-summary">{summaryContent}</div>
      )}
    </section>
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
          {item.status === "queued" || item.status === "failed" ? (
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
  if (status === "submitted") return "已提交，等待追加";
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
      <span>{message.statusText ?? (message.synthetic === "manualCompact" ? "正在压缩上下文" : "Codex 工作中")} · {formatDuration(elapsedMs)}</span>
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
}>(function QuickJump({
  turns,
  visibleTurnStartIndex,
  totalTurnCount,
  onBeforeJump
}, ref) {
  const allItems = useMemo(() => buildJumpItems(turns, visibleTurnStartIndex), [turns, visibleTurnStartIndex]);
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
    setActiveMessageId(messageId);
    anchor.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className="conversation-jump-rail" aria-label="消息快速跳转">
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

function RightDrawer({
  turns,
  cwd,
  visibleTurnStartIndex,
  totalTurnCount,
  open,
  onToggle,
  onBeforeJump,
  onRequestClose,
  showJumpNavigation,
  goal,
  onCreateGoal,
  onPauseGoal,
  onResumeGoal,
  onClearGoal,
  subagentThreads,
  activeThreadId,
  onSelectSubagent
}: {
  turns: MessageTurn[];
  cwd?: string;
  visibleTurnStartIndex: number;
  totalTurnCount: number;
  open: boolean;
  onToggle?: () => void;
  onBeforeJump: () => void;
  onRequestClose?: () => void;
  showJumpNavigation: boolean;
  goal?: ThreadGoal | null;
  onCreateGoal?: (objective: string) => void | Promise<void>;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onClearGoal?: () => void | Promise<void>;
  subagentThreads?: UiThread[];
  activeThreadId?: string | null;
  onSelectSubagent?: (thread: UiThread) => void;
}) {
  const [activeTab, setActiveTab] = useState<"goal" | "terminal">("goal");
  return (
    <>
      <button
        className="right-drawer-toggle"
        type="button"
        onClick={onToggle}
        title={open ? "收起右侧栏" : "展开右侧栏"}
        aria-label={open ? "收起右侧栏" : "展开右侧栏"}
        aria-expanded={open}
      >
        {open ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}
      </button>
      {open ? (
        <aside className={showJumpNavigation ? "right-drawer with-jump" : "right-drawer"} aria-label="右侧栏">
          <div className="right-drawer-body">
            <div className="right-drawer-tabs" role="tablist" aria-label="右侧栏视图">
              <button type="button" role="tab" aria-selected={activeTab === "goal"} className={activeTab === "goal" ? "active" : ""} onClick={() => setActiveTab("goal")}>目标</button>
              <button type="button" role="tab" aria-selected={activeTab === "terminal"} className={activeTab === "terminal" ? "active" : ""} onClick={() => setActiveTab("terminal")}>
                <SquareTerminal size={14} />
                终端
              </button>
            </div>
            {activeTab === "goal" ? (
              <>
                <GoalPanel
                  goal={goal}
                  onCreateGoal={onCreateGoal}
                  onPauseGoal={onPauseGoal}
                  onResumeGoal={onResumeGoal}
                  onClearGoal={onClearGoal}
                />
                <SubagentThreadPanel
                  threads={subagentThreads ?? []}
                  activeThreadId={activeThreadId}
                  onSelectSubagent={onSelectSubagent}
                />
              </>
            ) : (
              <TerminalPanel cwd={cwd} />
            )}
          </div>
          {showJumpNavigation ? (
            <div className="right-drawer-jump-host">
              <QuickJump
                turns={turns}
                visibleTurnStartIndex={visibleTurnStartIndex}
                totalTurnCount={totalTurnCount}
                onBeforeJump={() => {
                  onBeforeJump();
                  onRequestClose?.();
                }}
              />
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}

function GoalPanel({
  goal,
  onCreateGoal,
  onPauseGoal,
  onResumeGoal,
  onClearGoal
}: {
  goal?: ThreadGoal | null;
  onCreateGoal?: (objective: string) => void | Promise<void>;
  onPauseGoal?: () => void | Promise<void>;
  onResumeGoal?: () => void | Promise<void>;
  onClearGoal?: () => void | Promise<void>;
}) {
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const status = goal ? goalStatusView(goal.status) : null;

  async function run(action: (() => void | Promise<void>) | undefined) {
    if (!action || busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = objective.trim();
    if (!trimmed || !onCreateGoal || busy) return;
    setBusy(true);
    try {
      await onCreateGoal(trimmed);
      setObjective("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="right-drawer-goal" aria-label="目标">
      <div className="right-drawer-goal-heading">
        <span>目标</span>
        {status ? <strong className={status.tone}>{status.label}</strong> : null}
      </div>
      {goal ? (
        <>
          <p className="right-drawer-goal-objective">{goal.objective}</p>
          <div className="right-drawer-goal-meta">
            <span>{formatTokenCount(goal.tokensUsed)} tokens</span>
            <span>{formatDuration(goal.timeUsedSeconds * 1000)}</span>
            {goal.tokenBudget ? <span>预算 {formatTokenCount(goal.tokenBudget)}</span> : null}
          </div>
          <div className="right-drawer-goal-actions">
            {goal.status === "active" ? (
              <button type="button" disabled={busy || !onPauseGoal} onClick={() => void run(onPauseGoal)}>暂停</button>
            ) : goal.status === "paused" || goal.status === "blocked" ? (
              <button type="button" disabled={busy || !onResumeGoal} onClick={() => void run(onResumeGoal)}>继续</button>
            ) : null}
            <button type="button" disabled={busy || !onClearGoal} onClick={() => void run(onClearGoal)}>清除</button>
          </div>
        </>
      ) : (
        <form className="right-drawer-goal-form" onSubmit={(event) => void submitGoal(event)}>
          <textarea
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            placeholder="输入目标..."
            rows={4}
          />
          <button type="submit" disabled={busy || !objective.trim() || !onCreateGoal}>开始目标</button>
        </form>
      )}
    </section>
  );
}

function SubagentThreadPanel({
  threads,
  activeThreadId,
  onSelectSubagent
}: {
  threads: UiThread[];
  activeThreadId?: string | null;
  onSelectSubagent?: (thread: UiThread) => void;
}) {
  return (
    <section className="right-drawer-subagents" aria-label="子代理">
      <div className="right-drawer-section-heading">
        <span>子代理</span>
        {threads.length ? <strong>{threads.length}</strong> : null}
      </div>
      {threads.length ? (
        <div className="right-drawer-subagent-list">
          {threads.map((thread) => {
            const status = subagentThreadStatus(thread);
            return (
              <button
                key={thread.id}
                className={thread.id === activeThreadId ? "right-drawer-subagent-item active" : "right-drawer-subagent-item"}
                type="button"
                onClick={() => onSelectSubagent?.(thread)}
              >
                <span className={`right-drawer-subagent-dot ${status}`} title={subagentThreadStatusLabel(status)} />
                <span className="right-drawer-subagent-main">
                  <span className="right-drawer-subagent-title" title={thread.id}>{subagentThreadTitle(thread)}</span>
                  <span className="right-drawer-subagent-subtitle">{subagentThreadSubtitle(thread, status)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="right-drawer-subagent-empty">暂无子代理</p>
      )}
    </section>
  );
}

function subagentThreadTitle(thread: UiThread): string {
  return middleEllipsis(thread.id, 13, 12);
}

function subagentThreadSubtitle(thread: UiThread, status: "running" | "completed" | "failed"): string {
  return [
    subagentThreadStatusLabel(status),
    [thread.agentNickname, thread.agentRole].filter(Boolean).join(" · ")
  ].filter(Boolean).join(" · ");
}

function subagentThreadStatus(thread: UiThread): "running" | "completed" | "failed" {
  if (thread.status === "running" || thread.status === "failed") return thread.status;
  return "completed";
}

function subagentThreadStatusLabel(status: "running" | "completed" | "failed"): string {
  if (status === "running") return "正在工作";
  if (status === "failed") return "失败";
  return "已完成";
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function middleEllipsis(value: string, headLength: number, tailLength: number): string {
  if (value.length <= headLength + tailLength + 3) return value;
  return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
}

interface TerminalSessionSummary {
  id: string;
  cwd: string;
  name: string;
  shell: string;
  createdAt: number;
  updatedAt: number;
  status: "running" | "exited";
  exitCode?: number;
}

function TerminalPanel({ cwd }: { cwd?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitAddonRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const touchScrollYRef = useRef<number | null>(null);
  const touchScrollRemainderRef = useRef(0);
  const terminalOutputBuffersRef = useRef<Record<string, string>>({});
  const terminalOutputFrameRef = useRef<number | null>(null);
  const previousTerminalInputRef = useRef<{ input: string; at: number } | null>(null);
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectSessions = useMemo(() => sessions.filter((session) => sameTerminalPath(session.cwd, cwd)), [sessions, cwd]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | undefined;
    let cleanupTouchScroll: (() => void) | undefined;
    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit")
    ]).then(([xterm, fit]) => {
      if (disposed || !containerRef.current) return;
      const container = containerRef.current;
      const terminal = new xterm.Terminal({
        cursorBlink: false,
        convertEol: true,
        fontFamily: "Consolas, 'Cascadia Mono', 'SFMono-Regular', monospace",
        fontSize: 12,
        scrollback: 600,
        smoothScrollDuration: 0,
        theme: {
          background: "#101318",
          foreground: "#e8edf2",
          cursor: "#8fb7ff",
          selectionBackground: "#2d5aa7"
        }
      });
      const fitAddon = new fit.FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(container);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      fitAddon.fit();
      terminal.onData((data) => {
        const sessionId = activeSessionIdRef.current;
        const ws = wsRef.current;
        if (!sessionId || !ws || ws.readyState !== WebSocket.OPEN) return;
        const now = performance.now();
        if (shouldDropOverlappingTerminalInput(previousTerminalInputRef.current, data, now)) return;
        previousTerminalInputRef.current = { input: data, at: now };
        ws.send(JSON.stringify({ type: "terminal.input", sessionId, input: data }));
      });
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        sendTerminalResize();
      });
      resizeObserver.observe(container);
      cleanupTouchScroll = bindTerminalTouchScroll(container, terminal, touchScrollYRef, touchScrollRemainderRef);
      sendTerminalResize();
    });
    return () => {
      disposed = true;
      if (terminalOutputFrameRef.current !== null) window.cancelAnimationFrame(terminalOutputFrameRef.current);
      terminalOutputFrameRef.current = null;
      terminalOutputBuffersRef.current = {};
      cleanupTouchScroll?.();
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(terminalWsUrl());
    wsRef.current = ws;
    ws.addEventListener("open", () => {
      setConnected(true);
      setError(null);
      ws.send(JSON.stringify({ type: "terminal.list" }));
    });
    ws.addEventListener("close", () => {
      setConnected(false);
      if (wsRef.current === ws) wsRef.current = null;
    });
    ws.addEventListener("error", () => {
      setConnected(false);
      setError("终端连接失败");
    });
    ws.addEventListener("message", (event) => {
      const message = safeJson(event.data);
      if (!message || typeof message !== "object") return;
      handleTerminalMessage(message as Record<string, unknown>);
    });
    return () => {
      ws.close();
      if (wsRef.current === ws) wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!activeSessionId || !connected) return;
    terminalRef.current?.reset();
    wsRef.current?.send(JSON.stringify({ type: "terminal.attach", sessionId: activeSessionId }));
    sendTerminalResize();
  }, [activeSessionId, connected]);

  function handleTerminalMessage(message: Record<string, unknown>) {
    const type = message.type;
    if (type === "hello" || type === "terminal.hello" || type === "terminal.sessions") {
      const nextSessions = normalizeTerminalSessions(message.terminalSessions ?? message.sessions);
      setSessions(nextSessions);
      setActiveSessionId((current) => current && nextSessions.some((session) => session.id === current && sameTerminalPath(session.cwd, cwd))
        ? current
        : nextSessions.find((session) => sameTerminalPath(session.cwd, cwd))?.id ?? null);
      return;
    }
    if (type === "terminal.created" || type === "terminal.attached" || type === "terminal.closed") {
      const nextSessions = normalizeTerminalSessions(message.sessions);
      setSessions(nextSessions);
      if (type === "terminal.created") {
        const created = normalizeTerminalSession(message.session);
        if (created) setActiveSessionId(created.id);
      } else {
        setActiveSessionId((current) => current && nextSessions.some((session) => session.id === current && sameTerminalPath(session.cwd, cwd))
          ? current
          : nextSessions.find((session) => sameTerminalPath(session.cwd, cwd))?.id ?? null);
      }
      return;
    }
    if (type === "terminal.snapshot") {
      if (message.sessionId !== activeSessionIdRef.current) return;
      clearQueuedTerminalOutput();
      terminalRef.current?.reset();
      terminalRef.current?.write(String(message.output ?? ""));
      return;
    }
    if (type === "terminal.output") {
      if (message.sessionId !== activeSessionIdRef.current) return;
      queueTerminalOutput(String(message.sessionId), String(message.data ?? ""));
      return;
    }
    if (type === "terminal.exit") {
      const sessionId = String(message.sessionId ?? "");
      setSessions((current) => current.map((session) => session.id === sessionId ? { ...session, status: "exited", exitCode: Number(message.exitCode ?? 0) } : session));
      return;
    }
    if (type === "terminal.error") {
      setError(String(message.message ?? "终端错误"));
    }
  }

  function createTerminal() {
    const ws = wsRef.current;
    if (!cwd || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: "terminal.create",
      cwd,
      cols: terminalRef.current?.cols ?? 80,
      rows: terminalRef.current?.rows ?? 24
    }));
  }

  function closeTerminal(sessionId: string) {
    wsRef.current?.send(JSON.stringify({ type: "terminal.close", sessionId }));
  }

  function sendTerminalResize() {
    const sessionId = activeSessionIdRef.current;
    const terminal = terminalRef.current;
    const ws = wsRef.current;
    if (!sessionId || !terminal || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "terminal.resize", sessionId, cols: terminal.cols, rows: terminal.rows }));
  }

  function queueTerminalOutput(sessionId: string, data: string) {
    terminalOutputBuffersRef.current[sessionId] = `${terminalOutputBuffersRef.current[sessionId] ?? ""}${data}`;
    if (terminalOutputFrameRef.current !== null) return;
    terminalOutputFrameRef.current = window.requestAnimationFrame(() => {
      terminalOutputFrameRef.current = null;
      const activeSessionId = activeSessionIdRef.current;
      if (!activeSessionId || !terminalRef.current) {
        terminalOutputBuffersRef.current = {};
        return;
      }
      const output = terminalOutputBuffersRef.current[activeSessionId];
      terminalOutputBuffersRef.current = {};
      if (output) terminalRef.current.write(output);
    });
  }

  function clearQueuedTerminalOutput() {
    if (terminalOutputFrameRef.current !== null) window.cancelAnimationFrame(terminalOutputFrameRef.current);
    terminalOutputFrameRef.current = null;
    terminalOutputBuffersRef.current = {};
  }

  return (
    <section className="right-drawer-terminal" aria-label="终端">
      <div className="terminal-toolbar">
        <div className="terminal-tabs" role="tablist" aria-label="终端会话">
          {projectSessions.map((session, index) => (
            <div key={session.id} className={session.id === activeSessionId ? "terminal-tab active" : "terminal-tab"}>
              <button
                type="button"
                role="tab"
                aria-selected={session.id === activeSessionId}
                className="terminal-tab-select"
                onClick={() => setActiveSessionId(session.id)}
                title={`${session.name} · ${session.cwd}`}
              >
                <span>{index + 1}</span>
                {session.status === "exited" ? <em>已退出</em> : null}
              </button>
              <button
                type="button"
                className="terminal-tab-close"
                aria-label={`关闭终端 ${index + 1}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTerminal(session.id);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <button className="terminal-new-button" type="button" onClick={createTerminal} disabled={!connected || !cwd} title="新建终端">
          <Plus size={14} />
        </button>
      </div>
      <div className="terminal-shell">
        <div className="terminal-surface" ref={containerRef} />
        {projectSessions.length === 0 ? (
          <button className="terminal-empty" type="button" onClick={createTerminal} disabled={!connected || !cwd}>
            <SquareTerminal size={18} />
            <span>{connected ? "新建终端" : "正在连接终端..."}</span>
          </button>
        ) : null}
      </div>
      {error ? <p className="terminal-error">{error}</p> : null}
      <p className="terminal-cwd">{cwd ?? "未选择项目路径"}</p>
    </section>
  );
}

function normalizeTerminalSessions(value: unknown): TerminalSessionSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeTerminalSession).filter((session): session is TerminalSessionSummary => Boolean(session));
}

function normalizeTerminalSession(value: unknown): TerminalSessionSummary | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.cwd !== "string" || typeof record.name !== "string") return null;
  return {
    id: record.id,
    cwd: record.cwd,
    name: record.name,
    shell: typeof record.shell === "string" ? record.shell : "",
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : Date.now(),
    status: record.status === "exited" ? "exited" : "running",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : undefined
  };
}

function safeJson(input: unknown): any | null {
  if (typeof input !== "string") return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function sameTerminalPath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  return left.replace(/\\/g, "/").toLowerCase() === right.replace(/\\/g, "/").toLowerCase();
}

function bindTerminalTouchScroll(
  container: HTMLDivElement,
  terminal: import("@xterm/xterm").Terminal,
  lastYRef: { current: number | null },
  remainderRef: { current: number }
): () => void {
  const lineHeightPx = 16;
  const onTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) return;
    lastYRef.current = event.touches[0]?.clientY ?? null;
    remainderRef.current = 0;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || lastYRef.current === null) return;
    const currentY = event.touches[0]?.clientY ?? lastYRef.current;
    const deltaY = lastYRef.current - currentY;
    lastYRef.current = currentY;
    remainderRef.current += deltaY / lineHeightPx;
    const lines = Math.trunc(remainderRef.current);
    if (lines !== 0) {
      terminal.scrollLines(lines);
      remainderRef.current -= lines;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onTouchEnd = () => {
    lastYRef.current = null;
    remainderRef.current = 0;
  };
  container.addEventListener("touchstart", onTouchStart, { passive: true });
  container.addEventListener("touchmove", onTouchMove, { passive: false });
  container.addEventListener("touchend", onTouchEnd);
  container.addEventListener("touchcancel", onTouchEnd);
  return () => {
    container.removeEventListener("touchstart", onTouchStart);
    container.removeEventListener("touchmove", onTouchMove);
    container.removeEventListener("touchend", onTouchEnd);
    container.removeEventListener("touchcancel", onTouchEnd);
  };
}

export function shouldDropOverlappingTerminalInput(
  previous: { input: string; at: number } | null,
  input: string,
  at: number
): boolean {
  if (!previous) return false;
  if (previous.input.length < 2 || previous.input.length > 4) return false;
  if (input.length !== 1) return false;
  if (!previous.input.endsWith(input)) return false;
  return at - previous.at <= 8;
}

function goalStatusView(status: ThreadGoal["status"]): { tone: "active" | "paused" | "blocked"; label: string } {
  if (status === "active") return { tone: "active", label: "目标进行中" };
  if (status === "paused") return { tone: "paused", label: "目标已暂停" };
  return { tone: "blocked", label: "目标有阻碍" };
}

interface JumpItem {
  id: string;
  role: UiMessage["role"];
  globalIndex: number;
  preview: string;
}

function buildJumpItems(turns: MessageTurn[], visibleTurnStartIndex: number): JumpItem[] {
  return turns.map((turn, index) => {
    const userMessage = turn.messages.find((message) => message.role === "user") ?? turn.messages[0];
    return userMessage ? {
      id: userMessage.id,
      role: userMessage.role,
      globalIndex: visibleTurnStartIndex + index + 1,
      preview: previewText(userMessage)
    } : null;
  }).filter((item): item is JumpItem => Boolean(item));
}

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

function toolCardFrameKey(toolCall: UiToolCall): ToolCardFrameKey {
  if (toolCall.type === "commandExecution") return "command";
  if (toolCall.type === "fileChange") return "fileChange";
  if (toolCall.type === "mcpToolCall") return "mcp";
  if (toolCall.type === "dynamicToolCall") return "dynamic";
  if (toolCall.type === "webSearch") return "webSearch";
  if (toolCall.type === "imageView" || toolCall.type === "imageGeneration") return "image";
  if (toolCall.type === "plan") return "plan";
  return "other";
}

function isToolCardFrameEnabled(settings: ToolCardFrameSettings | undefined, key: ToolCardFrameKey): boolean {
  return settings?.[key] === true;
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

