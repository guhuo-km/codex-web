import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface TitleGenerationSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
}

export interface PublicTitleGenerationSettings {
  enabled: boolean;
  apiBaseUrl: string;
  apiKeyConfigured: boolean;
  model: string;
  timeoutMs: number;
}

export type TitleGenerationSettingsPatch = Partial<TitleGenerationSettings>;

const DEFAULT_SETTINGS: TitleGenerationSettings = {
  enabled: false,
  apiBaseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  timeoutMs: 10000
};

export class TitleGenerationStore {
  constructor(private readonly dataDir: string) {}

  async read(): Promise<TitleGenerationSettings> {
    try {
      const text = await readFile(this.filePath(), "utf8");
      return normalizeSettings(JSON.parse(text));
    } catch (error: any) {
      if (error?.code === "ENOENT") return DEFAULT_SETTINGS;
      throw error;
    }
  }

  async readPublic(): Promise<PublicTitleGenerationSettings> {
    return toPublicSettings(await this.read());
  }

  async write(patch: TitleGenerationSettingsPatch): Promise<TitleGenerationSettings> {
    const current = await this.read();
    const hasApiKeyPatch = Object.prototype.hasOwnProperty.call(patch, "apiKey");
    const next = normalizeSettings({
      ...current,
      ...patch,
      apiKey: hasApiKeyPatch ? patch.apiKey : current.apiKey
    });
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return next;
  }

  private filePath(): string {
    return join(this.dataDir, "title-generation.json");
  }
}

export function toPublicSettings(settings: TitleGenerationSettings): PublicTitleGenerationSettings {
  return {
    enabled: settings.enabled,
    apiBaseUrl: settings.apiBaseUrl,
    apiKeyConfigured: Boolean(settings.apiKey),
    model: settings.model,
    timeoutMs: settings.timeoutMs
  };
}

function normalizeSettings(input: unknown): TitleGenerationSettings {
  const value = input as Partial<TitleGenerationSettings>;
  const settings: TitleGenerationSettings = {
    enabled: Boolean(value.enabled),
    apiBaseUrl: normalizeString(value.apiBaseUrl) ?? DEFAULT_SETTINGS.apiBaseUrl,
    model: normalizeString(value.model) ?? DEFAULT_SETTINGS.model,
    timeoutMs: clampNumber(value.timeoutMs, 1000, 60000, DEFAULT_SETTINGS.timeoutMs)
  };
  const apiKey = normalizeString(value.apiKey);
  if (apiKey) settings.apiKey = apiKey;
  return settings;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
