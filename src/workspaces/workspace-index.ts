import { basename, win32 } from "node:path";

export interface ThreadSummaryLike {
  id: string;
  cwd: string;
  preview?: string;
  name?: string | null;
  updatedAt: number;
  status: string;
}

export interface WorkspaceGroup {
  cwd: string;
  name: string;
  updatedAt: number;
  runningCount: number;
  threads: ThreadSummaryLike[];
}

export function groupThreadsByWorkspace(threads: ThreadSummaryLike[]): WorkspaceGroup[] {
  const groups = new Map<string, WorkspaceGroup>();

  for (const thread of threads) {
    const group = groups.get(thread.cwd) ?? {
      cwd: thread.cwd,
      name: workspaceName(thread.cwd),
      updatedAt: 0,
      runningCount: 0,
      threads: []
    };
    group.threads.push(thread);
    group.updatedAt = Math.max(group.updatedAt, thread.updatedAt);
    group.runningCount += thread.status === "running" ? 1 : 0;
    groups.set(thread.cwd, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      threads: group.threads.sort((a, b) => b.updatedAt - a.updatedAt)
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function workspaceName(cwd: string): string {
  const name = basename(cwd);
  if (name !== cwd) return name;
  return win32.basename(cwd);
}
