import { ChevronRight, Folder, FolderPlus, HardDrive, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { FsDirectoryListing, FsEntry } from "../types";

interface ProjectPickerDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
}

export function ProjectPickerDialog({ open, onClose, onSelect }: ProjectPickerDialogProps) {
  const [listing, setListing] = useState<FsDirectoryListing | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ entry: FsEntry; x: number; y: number } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<FsEntry | null>(null);
  const cancelRenameRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  async function load(path?: string, selectPath?: string) {
    setLoading(true);
    setError(null);
    setContextMenu(null);
    try {
      const next = await api.fsList(path);
      setListing(next);
      setSelectedPath(selectPath ?? next.path);
      setPathInput(next.path);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取目录失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open]);

  useEffect(() => {
    if (!contextMenu) return;
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [contextMenu]);

  const breadcrumbs = useMemo(() => {
    return listing?.path ? buildBreadcrumbs(listing.path) : [];
  }, [listing?.path]);

  async function createFolder() {
    if (!listing) return;
    const name = nextFolderName(listing.entries.map((entry) => entry.name));
    try {
      const next = await api.fsCreateDirectory(listing.path, name);
      setListing(next);
      const entry = next.entries.find((item) => item.name === name);
      if (entry) {
        setSelectedPath(entry.path);
        setRenamingPath(entry.path);
        setRenamingValue(entry.name);
        cancelRenameRef.current = false;
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "创建文件夹失败");
    }
  }

  async function renameFolder(path: string, name: string) {
    const nextName = name.trim();
    if (!nextName) return;
    try {
      const next = await api.fsRenameDirectory(path, nextName);
      setListing(next);
      const entry = next.entries.find((item) => item.name === nextName);
      setSelectedPath(entry?.path ?? next.path);
      setRenamingPath(null);
      setContextMenu(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名失败");
    }
  }

  async function deleteFolder(path: string) {
    try {
      const next = await api.fsDeleteDirectory(path);
      setListing(next);
      setSelectedPath(next.path);
      setRenamingPath(null);
      setContextMenu(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
    }
  }

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="project-dialog" role="dialog" aria-modal="true" aria-label="添加项目">
        <header className="dialog-titlebar">
          <div>
            <h2>添加项目</h2>
            <p>选择本机目录作为项目根路径</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="file-toolbar">
          <button className="file-nav-button" type="button" disabled={!listing?.parentPath} onClick={() => void load(listing?.parentPath)}>
            上一级
          </button>
          <form
            className="path-form"
            onSubmit={(event) => {
              event.preventDefault();
              void load(pathInput);
            }}
          >
            <input value={pathInput} onChange={(event) => setPathInput(event.target.value)} spellCheck={false} />
            <button type="submit">转到</button>
          </form>
          <button className="file-nav-button create-folder-button" type="button" disabled={!listing} onClick={() => void createFolder()}>
            <FolderPlus size={15} />
            创建文件夹
          </button>
        </div>

        <div className="breadcrumb-row">
          {breadcrumbs.map((crumb, index) => (
            <button key={`${crumb.path}:${index}`} type="button" onClick={() => void load(crumb.path)}>
              {crumb.label}
              {index < breadcrumbs.length - 1 ? <ChevronRight size={13} /> : null}
            </button>
          ))}
        </div>

        <div className="file-browser">
          <aside className="drive-list">
            {listing?.roots.map((root) => (
              <button className={listing.path.startsWith(root.path) ? "drive-row active" : "drive-row"} key={root.path} type="button" onClick={() => void load(root.path)}>
                <HardDrive size={15} />
                <span>{root.name}</span>
              </button>
            ))}
          </aside>
          <main className="directory-list">
            {loading ? <div className="browser-note">正在读取...</div> : null}
            {error ? <div className="browser-error">{error}</div> : null}
            {!loading && !error && listing?.entries.length === 0 ? <div className="browser-note">没有子目录</div> : null}
            {listing?.entries.map((entry) => {
              const isRenaming = renamingPath === entry.path;
              return (
                <div
                  className={entry.path === selectedPath ? "directory-row active" : "directory-row"}
                  key={entry.path}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (!isRenaming) void load(entry.path);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedPath(entry.path);
                    setContextMenu({ entry, x: event.clientX, y: event.clientY });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !isRenaming) void load(entry.path);
                  }}
                >
                  <Folder size={16} />
                  {isRenaming ? (
                    <form
                      className="inline-rename-form"
                      onClick={(event) => event.stopPropagation()}
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameFolder(entry.path, renamingValue);
                      }}
                    >
                      <input
                        autoFocus
                        value={renamingValue}
                        onBlur={() => {
                          if (cancelRenameRef.current) {
                            cancelRenameRef.current = false;
                            return;
                          }
                          void renameFolder(entry.path, renamingValue);
                        }}
                        onChange={(event) => setRenamingValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelRenameRef.current = true;
                            setRenamingPath(null);
                          }
                        }}
                      />
                    </form>
                  ) : (
                    <>
                      <span>{entry.name}</span>
                      <button
                        className="directory-menu-button"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedPath(entry.path);
                          const rect = event.currentTarget.getBoundingClientRect();
                          setContextMenu({ entry, x: rect.right, y: rect.bottom });
                        }}
                        title="文件夹菜单"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </main>
        </div>
        {contextMenu ? (
          <div className="file-context-menu" ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              type="button"
              onClick={() => {
                setRenamingPath(contextMenu.entry.path);
                setRenamingValue(contextMenu.entry.name);
                cancelRenameRef.current = false;
                setContextMenu(null);
              }}
            >
              <Pencil size={14} />
              重命名
            </button>
            <button
              className="danger"
              type="button"
              onClick={() => {
                setDeleteTarget(contextMenu.entry);
                setContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              删除
            </button>
          </div>
        ) : null}
        {deleteTarget ? (
          <div className="nested-dialog-backdrop" role="presentation">
            <div className="confirm-dialog" role="dialog" aria-modal="true" aria-label="删除文件夹">
              <h3>删除文件夹</h3>
              <p title={deleteTarget.path}>{deleteTarget.path}</p>
              <div>
                <button type="button" onClick={() => setDeleteTarget(null)}>取消</button>
                <button
                  className="danger-action"
                  type="button"
                  onClick={() => {
                    void deleteFolder(deleteTarget.path);
                    setDeleteTarget(null);
                  }}
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <footer className="dialog-footer">
          <span>{selectedPath ?? "未选择目录"}</span>
          <button type="button" onClick={onClose}>取消</button>
          <button className="primary-dialog-action" type="button" disabled={!selectedPath} onClick={() => selectedPath && onSelect(selectedPath)}>
            添加
          </button>
        </footer>
      </div>
    </div>
  );
}

function nextFolderName(names: string[]): string {
  const base = "新建文件夹";
  const existing = new Set(names);
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} ${index}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

export function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  if (path.includes("\\")) return buildWindowsBreadcrumbs(path);
  return buildPosixBreadcrumbs(path);
}

function buildWindowsBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const normalized = path.replaceAll("/", "\\");
  const parts = normalized.split("\\").filter(Boolean);
  if (parts.length === 0) return [{ label: path, path }];

  const result: Array<{ label: string; path: string }> = [];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}${current.endsWith("\\") ? "" : "\\"}${part}` : part.endsWith(":") ? `${part}\\` : part;
    result.push({ label: part, path: current });
  }
  return result;
}

function buildPosixBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return [{ label: "/", path: "/" }];

  const result: Array<{ label: string; path: string }> = [{ label: "/", path: "/" }];
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : `/${part}`;
    result.push({ label: part, path: current });
  }
  return result;
}
