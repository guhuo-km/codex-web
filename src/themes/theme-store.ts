import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

export interface ThemeRecord {
  id: string;
  name: string;
  source: "builtin" | "custom";
  css: string;
}

const builtinThemes: Array<{ id: string; name: string; file: string }> = [
  { id: "default", name: "默认", file: "default.css" },
  { id: "claude", name: "Claude", file: "claude.css" },
  { id: "t3-chat", name: "T3 Chat", file: "t3-chat.css" },
  { id: "mono", name: "Mono", file: "mono.css" },
  { id: "bubblegum", name: "Bubblegum", file: "bubblegum.css" }
];

export class ThemeStore {
  constructor(
    private readonly dataDir: string,
    private readonly builtinDir = join(process.cwd(), "themes", "builtin")
  ) {}

  async list(): Promise<ThemeRecord[]> {
    return [...await this.listBuiltin(), ...await this.listCustom()];
  }

  async create(nameInput: string, cssInput: string): Promise<ThemeRecord[]> {
    const name = nameInput.trim();
    if (!name) throw new Error("主题名称不能为空");
    const id = safeThemeId(name);
    const css = sanitizeThemeCss(cssInput);
    if (!css) throw new Error("主题 CSS 不能为空");
    await mkdir(this.customDir(), { recursive: true });
    await writeFile(this.customPath(id), css, "utf8");
    return this.list();
  }

  async delete(idInput: string): Promise<ThemeRecord[]> {
    const id = safeThemeId(idInput);
    await rm(this.customPath(id), { force: true });
    return this.list();
  }

  private async listBuiltin(): Promise<ThemeRecord[]> {
    const themes = await Promise.all(builtinThemes.map(async (theme) => ({
      id: theme.id,
      name: theme.name,
      source: "builtin" as const,
      css: normalizeThemeCss(await readFile(join(this.builtinDir, theme.file), "utf8"))
    })));
    return themes;
  }

  private async listCustom(): Promise<ThemeRecord[]> {
    const dir = this.customDir();
    if (!existsSync(dir)) return [];
    const files = await readdir(dir, { withFileTypes: true });
    const records = await Promise.all(files
      .filter((file) => file.isFile() && file.name.endsWith(".css"))
      .map(async (file) => {
        const id = basename(file.name, ".css");
        return {
          id,
          name: nameFromId(id),
          source: "custom" as const,
          css: normalizeThemeCss(await readFile(join(dir, file.name), "utf8"))
        };
      }));
    return records.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  private customDir(): string {
    return join(this.dataDir, "themes");
  }

  private customPath(id: string): string {
    return join(this.customDir(), `${id}.css`);
  }
}

function safeThemeId(input: string): string {
  const normalized = input.trim().toLowerCase()
    .replace(/\.css$/i, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("主题名称无效");
  return normalized.slice(0, 60);
}

function nameFromId(id: string): string {
  return id.replace(/-/g, " ");
}

function sanitizeThemeCss(css: string): string {
  const blocks = css.match(/(?::root|\.dark|:root\.dark)\s*\{[^}]*\}/g) ?? [];
  return blocks
    .map((block) => {
      const selector = normalizeSelector(block.slice(0, block.indexOf("{")).trim());
      const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
      const variables = body
        .split(";")
        .map((line) => line.trim())
        .filter((line) => /^--[a-zA-Z0-9-_]+\s*:\s*[^;{}]+$/.test(line))
        .join(";\n  ");
      return variables ? `${selector} {\n  ${variables};\n}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function normalizeThemeCss(css: string): string {
  return css.replace(/(^|\n)\s*\.dark\s*\{/g, "$1:root.dark {");
}

function normalizeSelector(selector: string): string {
  return selector === ".dark" ? ":root.dark" : selector;
}
