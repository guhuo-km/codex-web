import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { TitleGenerationStore } from "../src/title-generation/title-generation-store.js";

describe("TitleGenerationStore", () => {
  let dataDir = "";

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "codex-title-generation-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test("stores custom chat completion settings without exposing the raw key publicly", async () => {
    const store = new TitleGenerationStore(dataDir);

    expect(await store.readPublic()).toEqual({
      enabled: false,
      apiBaseUrl: "https://api.openai.com/v1",
      apiKeyConfigured: false,
      model: "gpt-4o-mini",
      timeoutMs: 10000
    });

    const saved = await store.write({
      enabled: true,
      apiBaseUrl: "https://example.test/v1",
      apiKey: "secret-key",
      model: "title-model",
      timeoutMs: 5000
    });

    expect(saved.apiKey).toBe("secret-key");
    expect(await store.readPublic()).toEqual({
      enabled: true,
      apiBaseUrl: "https://example.test/v1",
      apiKeyConfigured: true,
      model: "title-model",
      timeoutMs: 5000
    });

    expect((await store.write({ model: "other-model" })).apiKey).toBe("secret-key");
    expect((await store.write({ apiKey: "" })).apiKey).toBeUndefined();
    expect((await store.readPublic()).apiKeyConfigured).toBe(false);
  });
});
