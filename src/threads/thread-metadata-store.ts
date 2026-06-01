import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ThreadMetadataRecord {
  id: string;
  cwd: string;
  pinned?: boolean;
  hidden?: boolean;
  deletedAt?: number;
  order?: number;
  updatedAt: number;
}

interface ThreadMetadataFile {
  threads?: ThreadMetadataRecord[];
}

export class ThreadMetadataStore {
  constructor(private readonly dataDir: string) {}

  async list(cwd?: string): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    return cwd ? records.filter((record) => record.cwd === cwd) : records;
  }

  async listArchived(cwd?: string): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    return (cwd ? records.filter((record) => record.cwd === cwd) : records)
      .filter((record) => record.hidden)
      .sort((a, b) => (b.deletedAt ?? b.updatedAt) - (a.deletedAt ?? a.updatedAt));
  }

  async pin(cwd: string, threadId: string): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    const projectRecords = records.filter((record) => record.cwd === cwd);
    const otherRecords = records.filter((record) => record.cwd !== cwd);
    const existing = projectRecords.find((record) => record.id === threadId);
    const nextRecord = normalizeRecord({
      id: threadId,
      cwd,
      pinned: !existing?.pinned,
      hidden: existing?.hidden,
      deletedAt: existing?.deletedAt,
      order: existing?.order,
      updatedAt: Date.now()
    });
    const nextProjectRecords = insertIntoPinnedPartition(
      projectRecords.filter((record) => record.id !== threadId),
      nextRecord
    );
    const next = [...otherRecords, ...renumber(nextProjectRecords)];
    await this.writeRecords(next);
    return next.filter((record) => record.cwd === cwd && !record.hidden);
  }

  async move(cwd: string, threadId: string, targetThreadId: string, placement: "before" | "after" = "after"): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    const projectRecords = records.filter((record) => record.cwd === cwd);
    const visibleProjectRecords = projectRecords.filter((record) => !record.hidden);
    const otherRecords = records.filter((record) => record.cwd !== cwd);
    const byId = new Map(visibleProjectRecords.map((record) => [record.id, record]));
    if (Boolean(byId.get(threadId)?.pinned) !== Boolean(byId.get(targetThreadId)?.pinned)) return projectRecords;
    const partitionPinned = Boolean(byId.get(threadId)?.pinned);
    const partitionRecords = visibleProjectRecords.filter((record) => Boolean(record.pinned) === partitionPinned);
    const otherProjectRecords = visibleProjectRecords.filter((record) => Boolean(record.pinned) !== partitionPinned);
    const hiddenProjectRecords = projectRecords.filter((record) => record.hidden);
    const ids = uniqueIds([threadId, targetThreadId, ...partitionRecords.sort(compareOrder).map((record) => record.id)]);
    const from = ids.indexOf(threadId);
    if (from < 0 || from === ids.indexOf(targetThreadId)) return projectRecords;
    const [moved] = ids.splice(from, 1);
    if (!moved) return projectRecords;
    const targetIndex = ids.indexOf(targetThreadId);
    if (targetIndex < 0) return projectRecords;
    ids.splice(placement === "after" ? targetIndex + 1 : targetIndex, 0, moved);

    const now = Date.now();
    const reordered: ThreadMetadataRecord[] = ids.map((id, index) => normalizeRecord({
      id,
      cwd,
      pinned: byId.get(id)?.pinned,
      hidden: byId.get(id)?.hidden,
      deletedAt: byId.get(id)?.deletedAt,
      order: index,
      updatedAt: now
    }));
    const nextProjectRecords = partitionPinned
      ? [...reordered, ...otherProjectRecords, ...hiddenProjectRecords]
      : [...otherProjectRecords, ...reordered, ...hiddenProjectRecords];
    const next = [...otherRecords, ...renumber(nextProjectRecords)];
    await this.writeRecords(next);
    return nextProjectRecords.filter((record) => !record.hidden);
  }

  async setOrder(cwd: string, threadIds: string[]): Promise<ThreadMetadataRecord[]> {
    const ids = uniqueIds(threadIds);
    if (!ids.length) return this.list(cwd);
    const records = await this.readRecords();
    const projectRecords = records.filter((record) => record.cwd === cwd);
    const otherRecords = records.filter((record) => record.cwd !== cwd);
    const byId = new Map(projectRecords.map((record) => [record.id, record]));
    const now = Date.now();
    const ordered = ids.map((id, index) => normalizeRecord({
      id,
      cwd,
      pinned: byId.get(id)?.pinned,
      hidden: byId.get(id)?.hidden,
      deletedAt: byId.get(id)?.deletedAt,
      order: index,
      updatedAt: now
    }));
    const remaining = projectRecords.filter((record) => !ids.includes(record.id));
    const next = [...otherRecords, ...ordered, ...remaining];
    await this.writeRecords(next);
    return next.filter((record) => record.cwd === cwd && !record.hidden);
  }

  async delete(cwd: string, threadId: string): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    const projectRecords = records.filter((record) => record.cwd === cwd);
    const otherRecords = records.filter((record) => record.cwd !== cwd);
    const existing = projectRecords.find((record) => record.id === threadId);
    const now = Date.now();
    const hiddenRecord = normalizeRecord({
      id: threadId,
      cwd,
      pinned: existing?.pinned,
      hidden: true,
      deletedAt: now,
      order: existing?.order,
      updatedAt: now
    });
    const nextProjectRecords = [
      ...projectRecords.filter((record) => record.id !== threadId),
      hiddenRecord
    ];
    const next = [...otherRecords, ...nextProjectRecords];
    await this.writeRecords(next);
    return nextProjectRecords.filter((record) => !record.hidden);
  }

  async restore(cwd: string, threadId: string): Promise<ThreadMetadataRecord[]> {
    const records = await this.readRecords();
    const projectRecords = records.filter((record) => record.cwd === cwd);
    const otherRecords = records.filter((record) => record.cwd !== cwd);
    const existing = projectRecords.find((record) => record.id === threadId);
    if (!existing) return projectRecords.filter((record) => !record.hidden);
    const restored = normalizeRecord({
      ...existing,
      hidden: undefined,
      deletedAt: undefined,
      updatedAt: Date.now()
    });
    const nextProjectRecords = [
      ...projectRecords.filter((record) => record.id !== threadId),
      restored
    ];
    const next = [...otherRecords, ...nextProjectRecords];
    await this.writeRecords(next);
    return nextProjectRecords.filter((record) => !record.hidden);
  }

  private async readRecords(): Promise<ThreadMetadataRecord[]> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(text) as ThreadMetadataFile;
      return Array.isArray(parsed.threads) ? parsed.threads : [];
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeRecords(threads: ThreadMetadataRecord[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify({ threads }, null, 2)}\n`, "utf8");
  }

  private filePath(): string {
    return join(this.dataDir, "thread-metadata.json");
  }
}

function compareOrder(a: ThreadMetadataRecord, b: ThreadMetadataRecord): number {
  return (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER);
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function insertIntoPinnedPartition(records: ThreadMetadataRecord[], record: ThreadMetadataRecord): ThreadMetadataRecord[] {
  const pinnedCount = records.filter((item) => item.pinned).length;
  const insertAt = record.pinned ? 0 : pinnedCount;
  const next = [...records.sort(compareOrder)];
  next.splice(insertAt, 0, record);
  return next;
}

function renumber(records: ThreadMetadataRecord[]): ThreadMetadataRecord[] {
  return records.map((record, index) => ({ ...record, order: index }));
}

function normalizeRecord(record: ThreadMetadataRecord): ThreadMetadataRecord {
  return {
    ...record,
    pinned: record.pinned ? true : undefined,
    hidden: record.hidden ? true : undefined
  };
}
