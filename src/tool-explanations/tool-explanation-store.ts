import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ToolExplanationIdentity {
  threadId: string;
  turnId: string;
  toolCallId: string;
  command: string;
}

export interface ToolExplanationRecord extends ToolExplanationIdentity {
  commandHash: string;
  explanation: string;
  createdAt: number;
  updatedAt: number;
}

interface ToolExplanationFile {
  records?: ToolExplanationRecord[];
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

export class ToolExplanationStore {
  constructor(
    private readonly dataDir: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES
  ) {}

  async get(input: ToolExplanationIdentity): Promise<string | undefined> {
    const record = (await this.readRecords()).find((item) => recordKey(item) === identityKey(input));
    return record?.explanation;
  }

  async set(input: ToolExplanationIdentity, explanation: string): Promise<void> {
    const clean = explanation.trim();
    if (!clean) return;
    const records = await this.readRecords();
    const now = Date.now();
    const key = identityKey(input);
    const nextRecord: ToolExplanationRecord = {
      ...input,
      command: input.command.trim(),
      commandHash: commandHash(input.command),
      explanation: clean,
      createdAt: records.find((item) => recordKey(item) === key)?.createdAt ?? now,
      updatedAt: now
    };
    const next = [...records.filter((item) => recordKey(item) !== key), nextRecord];
    await this.writeRecords(pruneToLimit(next, this.maxBytes));
  }

  async annotate(input: unknown): Promise<unknown> {
    const records = await this.readRecords();
    if (!records.length) return input;
    const byKey = new Map(records.map((record) => [recordKey(record), record.explanation]));
    return annotateValue(input, byKey);
  }

  private async readRecords(): Promise<ToolExplanationRecord[]> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      const parsed = JSON.parse(text) as ToolExplanationFile;
      return Array.isArray(parsed.records) ? parsed.records.filter(isRecord) : [];
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  private async writeRecords(records: ToolExplanationRecord[]): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify({ records }, null, 2)}\n`, "utf8");
  }

  private filePath(): string {
    return join(this.dataDir, "tool-explanations.json");
  }
}

function annotateValue(value: unknown, explanations: Map<string, string>, context: { threadId?: string; turnId?: string } = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => annotateValue(item, explanations, context));
  if (!value || typeof value !== "object") return value;

  const source = value as Record<string, unknown>;
  const threadId = typeof source.threadId === "string" ? source.threadId : typeof source.id === "string" && hasThreadTurns(source) ? source.id : context.threadId;
  const turnId = typeof source.turnId === "string" ? source.turnId : typeof source.id === "string" && hasTurnItems(source) ? source.id : context.turnId;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    next[key] = annotateValue(child, explanations, { threadId, turnId });
  }

  if (next.type === "commandExecution" && typeof next.id === "string" && typeof next.command === "string" && threadId && turnId) {
    const explanation = explanations.get(identityKey({
      threadId,
      turnId,
      toolCallId: next.id,
      command: next.command
    }));
    if (explanation) next.commandExplanation = explanation;
  }

  return next;
}

function hasTurnItems(value: Record<string, unknown>): boolean {
  return Array.isArray(value.items);
}

function hasThreadTurns(value: Record<string, unknown>): boolean {
  return Array.isArray(value.turns);
}

function isRecord(value: unknown): value is ToolExplanationRecord {
  const item = value as ToolExplanationRecord;
  return Boolean(
    item &&
    typeof item.threadId === "string" &&
    typeof item.turnId === "string" &&
    typeof item.toolCallId === "string" &&
    typeof item.command === "string" &&
    typeof item.commandHash === "string" &&
    typeof item.explanation === "string"
  );
}

function pruneToLimit(records: ToolExplanationRecord[], maxBytes: number): ToolExplanationRecord[] {
  let next = [...records].sort((a, b) => a.updatedAt - b.updatedAt);
  while (next.length && byteLength(next) > maxBytes) {
    next = next.slice(1);
  }
  return next;
}

function byteLength(records: ToolExplanationRecord[]): number {
  return Buffer.byteLength(JSON.stringify({ records }), "utf8");
}

function identityKey(input: ToolExplanationIdentity): string {
  return `${input.threadId}\n${input.turnId}\n${input.toolCallId}\n${commandHash(input.command)}`;
}

function recordKey(record: ToolExplanationRecord): string {
  return `${record.threadId}\n${record.turnId}\n${record.toolCallId}\n${record.commandHash}`;
}

function commandHash(command: string): string {
  return createHash("sha256").update(command.trim()).digest("hex");
}
