import { mkdtemp, rm } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CodexAppServerManager } from "../src/codex/app-server-manager.js";
import { loadConfig } from "../src/config.js";

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CodexAppServerManager", () => {
  test("attach mode does not spawn", async () => {
    const spawn = vi.fn();
    const manager = new CodexAppServerManager(
      loadConfig({ CODEX_APP_SERVER_URL: "ws://127.0.0.1:5555" }),
      { spawn, fetch: vi.fn() as any }
    );

    const endpoint = await manager.ensureRunning();

    expect(endpoint.url).toBe("ws://127.0.0.1:5555");
    expect(endpoint.token).toBeUndefined();
    expect(spawn).not.toHaveBeenCalled();
  });

  test("managed mode writes token and spawns codex app-server", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
    tempDirs.push(dataDir);
    const child = { kill: vi.fn(), once: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
    const spawn = vi.fn(() => child);
    const fetch = vi.fn(async () => ({ ok: true }));
    const manager = new CodexAppServerManager(
      loadConfig({ DATA_DIR: dataDir, CODEX_APP_SERVER_PORT: "5556", CODEX_BIN: "codex-test" }),
      { spawn: spawn as any, fetch: fetch as any }
    );

    const endpoint = await manager.ensureRunning();

    expect(endpoint.url).toBe("ws://127.0.0.1:5556");
    expect(endpoint.token).toMatch(/^[a-f0-9]{64}$/);
    expect(spawn).toHaveBeenCalledWith(
      "codex-test",
      [
        "app-server",
        "--listen",
        "ws://127.0.0.1:5556",
        "--ws-auth",
        "capability-token",
        "--ws-token-file",
        expect.stringContaining("codex-ws-token-5556.txt")
      ],
      expect.objectContaining({ windowsHide: true, shell: false })
    );
    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:5556/readyz", expect.any(Object));

    await manager.shutdown();
    expect(child.kill).toHaveBeenCalled();
  });

  test("resolves codex command to the Windows vendor executable when available", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
    tempDirs.push(dataDir);
    const child = { kill: vi.fn(), once: vi.fn(), on: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
    const spawn = vi.fn(() => child);
    const fetch = vi.fn(async () => ({ ok: true }));
    const vendorBin =
      "C:\\nvm4w\\nodejs\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe";
    const manager = new CodexAppServerManager(
      loadConfig({ DATA_DIR: dataDir, CODEX_APP_SERVER_PORT: "5557" }),
      {
        spawn: spawn as any,
        fetch: fetch as any,
        platform: "win32",
        pathEnv: "C:\\nvm4w\\nodejs",
        existsSync: (path) => path === vendorBin
      }
    );

    await manager.ensureRunning();

    expect((spawn.mock.calls as any[])[0][0]).toBe(vendorBin);
    expect((spawn.mock.calls as any[])[0][2]).toEqual(expect.objectContaining({ shell: false }));
  });

  test("attaches to an existing managed app-server when token file exists", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
    tempDirs.push(dataDir);
    await writeFile(join(dataDir, "codex-ws-token-5558.txt"), "existing-token", "utf8");
    const spawn = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true }));
    const manager = new CodexAppServerManager(
      loadConfig({ DATA_DIR: dataDir, CODEX_APP_SERVER_PORT: "5558" }),
      { spawn: spawn as any, fetch: fetch as any }
    );

    const endpoint = await manager.ensureRunning();

    expect(endpoint).toEqual({ url: "ws://127.0.0.1:5558", token: "existing-token" });
    expect(spawn).not.toHaveBeenCalled();
  });

  test("shutdown terminates the managed process tree on Windows", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
    tempDirs.push(dataDir);
    const child = { pid: 1234, kill: vi.fn(), once: vi.fn(), stdout: { on: vi.fn() }, stderr: { on: vi.fn() } };
    const spawn = vi.fn(() => child);
    const fetch = vi.fn(async () => ({ ok: true }));
    const killProcessTree = vi.fn(async () => undefined);
    const manager = new CodexAppServerManager(
      loadConfig({ DATA_DIR: dataDir, CODEX_APP_SERVER_PORT: "5560" }),
      {
        spawn: spawn as any,
        fetch: fetch as any,
        platform: "win32",
        killProcessTree
      }
    );

    await manager.ensureRunning();
    await manager.shutdown();

    expect(killProcessTree).toHaveBeenCalledWith(1234);
    expect(child.kill).not.toHaveBeenCalled();
  });

  test("attaches to an existing app-server with legacy token file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "codex-bridge-"));
    tempDirs.push(dataDir);
    await writeFile(join(dataDir, "codex-ws-token.txt"), "legacy-token", "utf8");
    const spawn = vi.fn();
    const fetch = vi.fn(async () => ({ ok: true }));
    const manager = new CodexAppServerManager(
      loadConfig({ DATA_DIR: dataDir, CODEX_APP_SERVER_PORT: "5559" }),
      { spawn: spawn as any, fetch: fetch as any }
    );

    const endpoint = await manager.ensureRunning();

    expect(endpoint).toEqual({ url: "ws://127.0.0.1:5559", token: "legacy-token" });
    expect(spawn).not.toHaveBeenCalled();
  });
});
