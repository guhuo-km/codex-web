import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { join } from "node:path";

export interface ProjectRecord {
  cwd: string;
  name: string;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  deletedAt?: number;
}

export class ProjectStore {
  constructor(private readonly dataDir: string) {}

  async list(): Promise<ProjectRecord[]> {
    return (await this.readProjects()).filter((project) => !project.archived);
  }

  async listArchived(): Promise<ProjectRecord[]> {
    return (await this.readProjects())
      .filter((project) => project.archived)
      .sort((a, b) => (b.deletedAt ?? b.updatedAt) - (a.deletedAt ?? a.updatedAt));
  }

  async add(cwd: string): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const existing = projects.find((project) => project.cwd === cwd);
    const record = {
      cwd,
      name: existing?.name ?? (basename(cwd) || cwd),
      updatedAt: Date.now(),
      pinned: existing?.pinned,
      archived: undefined,
      deletedAt: undefined
    };
    const next = insertIntoPinnedPartition(projects.filter((project) => project.cwd !== cwd), record);
    await this.writeProjects(next);
    return next.filter((project) => !project.archived);
  }

  async rename(cwd: string, name: string): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const next = projects.map((project) => project.cwd === cwd ? { ...project, name } : project);
    await this.writeProjects(next);
    return next.filter((project) => !project.archived);
  }

  async pin(cwd: string): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const target = projects.find((project) => project.cwd === cwd);
    if (!target || target.archived) return projects.filter((project) => !project.archived);
    const updatedTarget = { ...target, pinned: !target.pinned };
    const next = insertIntoPinnedPartition(projects.filter((project) => project.cwd !== cwd), updatedTarget);
    await this.writeProjects(next);
    return next.filter((project) => !project.archived);
  }

  async move(cwd: string, direction: "up" | "down"): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const archivedProjects = projects.filter((project) => project.archived);
    const visibleProjects = projects.filter((project) => !project.archived);
    const index = visibleProjects.findIndex((project) => project.cwd === cwd);
    if (index < 0) return visibleProjects;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= visibleProjects.length) return visibleProjects;
    if (Boolean(visibleProjects[index]?.pinned) !== Boolean(visibleProjects[targetIndex]?.pinned)) return visibleProjects;
    const next = [...visibleProjects];
    [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
    await this.writeProjects([...next, ...archivedProjects]);
    return next;
  }

  async delete(cwd: string): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const now = Date.now();
    const existing = projects.find((project) => project.cwd === cwd);
    const archivedProject: ProjectRecord = {
      cwd,
      name: existing?.name ?? (basename(cwd) || cwd),
      updatedAt: now,
      pinned: existing?.pinned,
      archived: true,
      deletedAt: now
    };
    const next = [...projects.filter((project) => project.cwd !== cwd), archivedProject];
    await this.writeProjects(next);
    return next.filter((project) => !project.archived);
  }

  async restore(cwd: string): Promise<ProjectRecord[]> {
    const projects = await this.readProjects();
    const existing = projects.find((project) => project.cwd === cwd);
    if (!existing) return this.add(cwd);
    const restored: ProjectRecord = {
      ...existing,
      archived: undefined,
      deletedAt: undefined,
      updatedAt: Date.now()
    };
    const next = insertIntoPinnedPartition(projects.filter((project) => project.cwd !== cwd), restored);
    await this.writeProjects(next);
    return next.filter((project) => !project.archived);
  }

  private async readProjects(): Promise<ProjectRecord[]> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(text) as { projects?: ProjectRecord[] };
      return Array.isArray(parsed.projects) ? parsed.projects : [];
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeProjects(projects: ProjectRecord[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
  }

  private filePath(): string {
    return join(this.dataDir, "projects.json");
  }
}

function insertIntoPinnedPartition(projects: ProjectRecord[], record: ProjectRecord): ProjectRecord[] {
  const archivedProjects = projects.filter((project) => project.archived);
  const visibleProjects = projects.filter((project) => !project.archived);
  const pinnedCount = visibleProjects.filter((project) => project.pinned).length;
  const insertAt = record.pinned ? 0 : pinnedCount;
  const next = [...visibleProjects];
  next.splice(insertAt, 0, record);
  return [...next, ...archivedProjects];
}
