import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { UserPreferencesStore } from "../src/preferences/user-preferences-store.js";

let dataDir: string | null = null;

afterEach(async () => {
  if (dataDir) {
    await rm(dataDir, { recursive: true, force: true });
    dataDir = null;
  }
});

async function makeStore() {
  dataDir = await mkdtemp(join(tmpdir(), "codex-web-preferences-"));
  return new UserPreferencesStore(dataDir);
}

describe("UserPreferencesStore", () => {
  test("persists the tool group collapse mode", async () => {
    const store = await makeStore();

    const preferences = await store.update({ toolGroupCollapseMode: "collapseAfterComplete" });

    expect(preferences.toolGroupCollapseMode).toBe("collapseAfterComplete");
    expect(preferences.collapseToolGroupsByDefault).toBe(false);
    await expect(store.read()).resolves.toEqual(expect.objectContaining({
      toolGroupCollapseMode: "collapseAfterComplete"
    }));
  });

  test("migrates the legacy collapse boolean", async () => {
    const store = await makeStore();
    await writeFile(join(dataDir!, "user-preferences.json"), JSON.stringify({ collapseToolGroupsByDefault: true }), "utf8");

    const preferences = await store.read();

    expect(preferences.toolGroupCollapseMode).toBe("alwaysCollapsed");
    expect(preferences.collapseToolGroupsByDefault).toBe(true);
  });
});
