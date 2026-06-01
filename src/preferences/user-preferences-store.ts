import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ColorMode = "light" | "dark";
export type WorkMode = "default" | "auto-review" | "full-access" | "yolo";
export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type SendBehavior = "enter" | "shiftEnter";
export type ToolGroupCollapseMode = "alwaysCollapsed" | "alwaysExpanded" | "collapseAfterComplete";

export interface UserPreferences {
  colorMode: ColorMode;
  activeThemeId: string;
  collapseToolGroupsByDefault: boolean;
  toolGroupCollapseMode: ToolGroupCollapseMode;
  approvalDetailsCollapsedByDefault: boolean;
  renderUserMessagesAsMarkdown: boolean;
  historyCacheTurnLimit: number;
  sidebarWidth: number;
  sidebarCollapsed?: boolean;
  sendBehavior: SendBehavior;
  defaultModel?: string;
  defaultWorkMode: WorkMode;
  defaultEffort: ReasoningEffort;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  colorMode: "light",
  activeThemeId: "default",
  collapseToolGroupsByDefault: false,
  toolGroupCollapseMode: "alwaysExpanded",
  approvalDetailsCollapsedByDefault: true,
  renderUserMessagesAsMarkdown: false,
  historyCacheTurnLimit: 30,
  sidebarWidth: 286,
  sendBehavior: "enter",
  defaultWorkMode: "yolo",
  defaultEffort: "medium"
};

export class UserPreferencesStore {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<UserPreferences> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      return normalizePreferences(JSON.parse(text));
    } catch (error: any) {
      if (error?.code === "ENOENT") return DEFAULT_PREFERENCES;
      throw error;
    }
  }

  async update(patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const current = await this.read();
    const next = normalizePreferences({ ...current, ...patch });
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  private filePath(): string {
    return join(this.dataDir, "user-preferences.json");
  }
}

function normalizePreferences(input: unknown): UserPreferences {
  const value = input as Partial<UserPreferences>;
  const toolGroupCollapseMode = normalizeToolGroupCollapseMode(value.toolGroupCollapseMode, value.collapseToolGroupsByDefault);
  return {
    colorMode: value.colorMode === "dark" ? "dark" : "light",
    activeThemeId: typeof value.activeThemeId === "string" && value.activeThemeId.trim() ? value.activeThemeId : DEFAULT_PREFERENCES.activeThemeId,
    collapseToolGroupsByDefault: toolGroupCollapseMode === "alwaysCollapsed",
    toolGroupCollapseMode,
    approvalDetailsCollapsedByDefault: value.approvalDetailsCollapsedByDefault !== false,
    renderUserMessagesAsMarkdown: Boolean(value.renderUserMessagesAsMarkdown),
    historyCacheTurnLimit: clampNumber(value.historyCacheTurnLimit, 20, 200, DEFAULT_PREFERENCES.historyCacheTurnLimit),
    sidebarWidth: clampNumber(value.sidebarWidth, 240, 520, DEFAULT_PREFERENCES.sidebarWidth),
    sidebarCollapsed: Boolean(value.sidebarCollapsed),
    sendBehavior: normalizeSendBehavior(value.sendBehavior),
    defaultModel: typeof value.defaultModel === "string" && value.defaultModel.trim() ? value.defaultModel : undefined,
    defaultWorkMode: isWorkMode(value.defaultWorkMode) ? value.defaultWorkMode : DEFAULT_PREFERENCES.defaultWorkMode,
    defaultEffort: isReasoningEffort(value.defaultEffort) ? value.defaultEffort : DEFAULT_PREFERENCES.defaultEffort
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isWorkMode(value: unknown): value is WorkMode {
  return value === "default" || value === "auto-review" || value === "full-access" || value === "yolo";
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function normalizeSendBehavior(value: unknown): SendBehavior {
  if (value === "shiftEnter" || value === "modEnter") return "shiftEnter";
  return DEFAULT_PREFERENCES.sendBehavior;
}

function normalizeToolGroupCollapseMode(value: unknown, legacyCollapseByDefault: unknown): ToolGroupCollapseMode {
  if (value === "alwaysCollapsed" || value === "alwaysExpanded" || value === "collapseAfterComplete") return value;
  return legacyCollapseByDefault ? "alwaysCollapsed" : DEFAULT_PREFERENCES.toolGroupCollapseMode;
}
