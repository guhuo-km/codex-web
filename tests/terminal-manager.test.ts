import { describe, expect, test } from "vitest";
import { TerminalManager } from "../src/terminal/terminal-manager.js";

describe("TerminalManager", () => {
  test("list returns JSON-safe session summaries", () => {
    const manager = new TerminalManager();
    const timer = setTimeout(() => {}, 1000);
    clearTimeout(timer);
    (manager as any).sessions.set("session-1", {
      id: "session-1",
      cwd: "D:\\codex-web",
      name: "codex-web 1",
      shell: "powershell.exe",
      createdAt: 1,
      updatedAt: 2,
      status: "running",
      output: "",
      pendingOutput: "pending",
      outputFlushTimer: timer,
      subscribers: new Set()
    });

    const sessions = manager.list();

    expect(() => JSON.stringify({ sessions })).not.toThrow();
    expect(sessions).toEqual([{
      id: "session-1",
      cwd: "D:\\codex-web",
      name: "codex-web 1",
      shell: "powershell.exe",
      createdAt: 1,
      updatedAt: 2,
      status: "running"
    }]);
  });
});
