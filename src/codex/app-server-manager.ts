import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync as nodeExistsSync } from "node:fs";
import { delimiter, join, win32 } from "node:path";
import { spawn as nodeSpawn, spawnSync, type ChildProcess } from "node:child_process";
import type { AppConfig } from "../config.js";
import { AppError } from "../errors.js";

export interface CodexAppServerEndpoint {
  url: string;
  token?: string;
}

type SpawnFn = typeof nodeSpawn;
type FetchFn = typeof fetch;
type KillProcessTreeFn = (pid: number) => Promise<void>;

export interface CodexAppServerManagerDeps {
  spawn?: SpawnFn | ((command: string, args: string[], options: unknown) => ChildProcess);
  fetch?: FetchFn;
  platform?: NodeJS.Platform;
  existsSync?: (path: string) => boolean;
  pathEnv?: string;
  killProcessTree?: KillProcessTreeFn;
}

export class CodexAppServerManager {
  private child?: ChildProcess;
  private endpoint?: CodexAppServerEndpoint;
  private readonly spawnFn: SpawnFn | ((command: string, args: string[], options: unknown) => ChildProcess);
  private readonly fetchFn: FetchFn;
  private readonly platform: NodeJS.Platform;
  private readonly existsSync: (path: string) => boolean;
  private readonly pathEnv: string;
  private readonly killProcessTree: KillProcessTreeFn;
  private startupError?: Error;

  constructor(
    private readonly config: AppConfig,
    deps: CodexAppServerManagerDeps = {}
  ) {
    this.spawnFn = deps.spawn ?? nodeSpawn;
    this.fetchFn = deps.fetch ?? fetch;
    this.platform = deps.platform ?? process.platform;
    this.existsSync = deps.existsSync ?? nodeExistsSync;
    this.pathEnv = deps.pathEnv ?? process.env.PATH ?? process.env.Path ?? "";
    this.killProcessTree = deps.killProcessTree ?? killProcessTree;
  }

  async ensureRunning(): Promise<CodexAppServerEndpoint> {
    if (this.endpoint) return this.endpoint;

    if (this.config.codexAppServerUrl) {
      this.endpoint = { url: this.config.codexAppServerUrl };
      return this.endpoint;
    }

    const tokenFile = join(this.config.dataDir, `codex-ws-token-${this.config.codexAppServerPort}.txt`);
    const legacyTokenFile = join(this.config.dataDir, "codex-ws-token.txt");
    const url = `ws://127.0.0.1:${this.config.codexAppServerPort}`;
    const existingToken = await this.readTokenIfReady([tokenFile, legacyTokenFile]);
    if (existingToken) {
      this.endpoint = { url, token: existingToken };
      return this.endpoint;
    }

    await mkdir(this.config.dataDir, { recursive: true });
    const token = randomBytes(32).toString("hex");
    await writeFile(tokenFile, token, "utf8");

    const args = [
      "app-server",
      "--listen",
      url,
      "--ws-auth",
      "capability-token",
      "--ws-token-file",
      tokenFile
    ];
    const env = {
      ...process.env,
      ...(this.config.codexHome ? { CODEX_HOME: this.config.codexHome } : {})
    };

    const command = this.resolveCodexCommand();
    this.child = this.spawnFn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: shouldUseShell(command, this.platform)
    }) as ChildProcess;
    this.child.once("error", (error) => {
      this.startupError = error;
    });

    await this.waitForReady();
    this.endpoint = { url, token };
    return this.endpoint;
  }

  async shutdown(): Promise<void> {
    if (!this.child) return;
    if (this.platform === "win32" && this.child.pid) {
      await this.killProcessTree(this.child.pid);
    } else {
      this.child.kill();
    }
    this.child = undefined;
    this.endpoint = undefined;
  }

  private async waitForReady(): Promise<void> {
    const readyUrl = `http://127.0.0.1:${this.config.codexAppServerPort}/readyz`;
    const deadline = Date.now() + 15_000;
    let lastError: unknown;

    while (Date.now() < deadline) {
      if (this.startupError) {
        throw new AppError(
          `Failed to start Codex app-server: ${this.startupError.message}`,
          "CODEX_APP_SERVER_START_FAILED",
          503
        );
      }
      try {
        const response = await this.fetchFn(readyUrl, { signal: AbortSignal.timeout(1000) });
        if (response.ok) return;
      } catch (error) {
        lastError = error;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new AppError(
      `Codex app-server did not become ready${lastError instanceof Error ? `: ${lastError.message}` : ""}`,
      "CODEX_APP_SERVER_NOT_READY",
      503
    );
  }

  private async readTokenIfReady(tokenFiles: string[]): Promise<string | undefined> {
    try {
      const response = await this.fetchFn(`http://127.0.0.1:${this.config.codexAppServerPort}/readyz`, {
        signal: AbortSignal.timeout(500)
      });
      if (!response.ok) return undefined;
      for (const tokenFile of tokenFiles) {
        try {
          return (await readFile(tokenFile, "utf8")).trim();
        } catch (error: any) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private resolveCodexCommand(): string {
    if (this.config.codexBin !== "codex" || this.platform !== "win32") {
      return this.config.codexBin;
    }

    for (const dir of splitPathEnv(this.pathEnv, this.platform)) {
      const vendorBin = joinForPlatform(
        this.platform,
        dir,
        "node_modules",
        "@openai",
        "codex",
        "node_modules",
        "@openai",
        "codex-win32-x64",
        "vendor",
        "x86_64-pc-windows-msvc",
        "bin",
        "codex.exe"
      );
      if (this.existsSync(vendorBin)) return vendorBin;

      const candidate = join(dir, "codex.cmd");
      if (this.existsSync(candidate)) return candidate;
    }
    return "codex.cmd";
  }
}

function joinForPlatform(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : join(...parts);
}

function shouldUseShell(command: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function splitPathEnv(pathEnv: string, platform: NodeJS.Platform): string[] {
  if (platform === "win32") return pathEnv.split(";").filter(Boolean);
  return pathEnv
    .split(delimiter)
    .filter(Boolean);
}

async function killProcessTree(pid: number): Promise<void> {
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true
  });
  if (result.error) throw result.error;
}
