import { Circle, PanelLeftClose, PanelLeftOpen, Plug, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CapabilityPayload, McpServerCapability, StatusPayload, TaskSummary } from "../types";

interface StatusBarProps {
  title: string;
  subtitle?: string;
  status: StatusPayload | null;
  tasks: TaskSummary[];
  onRefresh: () => void;
  capabilities: CapabilityPayload | null;
  onRefreshCapabilities: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

export function StatusBar({
  title,
  subtitle,
  status,
  tasks: _tasks,
  onRefresh,
  capabilities,
  onRefreshCapabilities,
  sidebarCollapsed,
  onToggleSidebar
}: StatusBarProps) {
  const [openMenu, setOpenMenu] = useState<"mcp" | "skills" | "plugins" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mcpServers = capabilities?.mcpServers?.data ?? [];

  useEffect(() => {
    if (!openMenu) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [openMenu]);

  return (
    <header className="conversation-topbar">
      <div className="conversation-title">
        <button
          className="icon-button sidebar-toggle-button"
          type="button"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
          aria-expanded={!sidebarCollapsed}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <span className="conversation-title-copy">
          <h1>{title || "新对话"}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </span>
      </div>
      <div className="conversation-tools">
        <span className="mini-pill">
          <Circle className={status?.connected ? "dot ok" : "dot bad"} />
          {status?.connected ? "已连接" : "未连接"}
        </span>
        <div className="status-menu-wrap" ref={menuRef}>
          <button className="mini-pill status-menu-trigger" type="button" onClick={() => {
            setOpenMenu((current) => current === "mcp" ? null : "mcp");
            onRefreshCapabilities();
          }}>
            <Plug size={13} />
            MCP
          </button>
          {openMenu === "mcp" ? <McpMenu servers={mcpServers} /> : null}
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onRefresh}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw size={16} />
        </button>
      </div>
    </header>
  );
}

function McpMenu({ servers }: { servers: McpServerCapability[] }) {
  return (
    <div className="status-popover mcp-popover">
      {servers.length ? servers.map((server) => (
        <div className="mcp-row" key={server.name}>
          <span className={`mcp-state-dot ${mcpOk(server) ? "ok" : "bad"}`} />
          <span className="mcp-name">{server.name}</span>
          <span className="mcp-tool-count">{toolCount(server)} 工具</span>
          <div className="mcp-detail-popover">
            <strong>{server.name}</strong>
            <span>认证：{authLabel(server.authStatus)}</span>
            <span>工具：{toolCount(server)}</span>
            <span>资源：{server.resources?.length ?? 0}</span>
            <span>模板：{server.resourceTemplates?.length ?? 0}</span>
          </div>
        </div>
      )) : (
        <div className="capability-empty">暂无 MCP</div>
      )}
    </div>
  );
}

function mcpOk(server: McpServerCapability): boolean {
  return server.authStatus !== "notLoggedIn" && toolCount(server) > 0;
}

function toolCount(server: McpServerCapability): number {
  return Object.keys(server.tools ?? {}).length;
}

function authLabel(status: string): string {
  if (status === "notLoggedIn") return "未登录";
  if (status === "bearerToken") return "Bearer Token";
  if (status === "oAuth") return "OAuth";
  return "无需登录";
}
