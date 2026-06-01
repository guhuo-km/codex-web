import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  test("uses safe defaults", () => {
    const config = loadConfig({});

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(49380);
    expect(config.frontendPort).toBe(49381);
    expect(config.codexBin).toBe("codex");
    expect(config.codexAppServerPort).toBe(49317);
    expect(config.dataDir).toBe(".data");
    expect(config.password).toBe("root");
    expect(config.enableExperimentalCodexApi).toBe(true);
  });

  test("parses overrides", () => {
    const config = loadConfig({
      CODEX_WEB_HOST: "127.0.0.1",
      CODEX_WEB_BACKEND_PORT: "50001",
      CODEX_WEB_FRONTEND_PORT: "50003",
      CODEX_WEB_PASSWORD: "secret-root",
      PUBLIC_BASE_URL: "http://example.test",
      CODEX_BIN: "C:\\tools\\codex.cmd",
      CODEX_HOME: "D:\\codex-home",
      CODEX_APP_SERVER_URL: "ws://127.0.0.1:50002",
      CODEX_APP_SERVER_PORT: "50002",
      DATA_DIR: "D:\\bridge-data",
      BRIDGE_TOKEN: "secret",
      ENABLE_EXPERIMENTAL_CODEX_API: "false",
      NOTIFY_URL: "http://notify.test/notify",
      NOTIFY_TOKEN: "notify-secret",
      NOTIFY_TARGET_TYPE: "private",
      NOTIFY_TARGET_ID: "123"
    });

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(50001);
    expect(config.frontendPort).toBe(50003);
    expect(config.publicBaseUrl).toBe("http://example.test");
    expect(config.codexBin).toBe("C:\\tools\\codex.cmd");
    expect(config.codexHome).toBe("D:\\codex-home");
    expect(config.codexAppServerUrl).toBe("ws://127.0.0.1:50002");
    expect(config.codexAppServerPort).toBe(50002);
    expect(config.dataDir).toBe("D:\\bridge-data");
    expect(config.bridgeToken).toBe("secret");
    expect(config.password).toBe("secret-root");
    expect(config.enableExperimentalCodexApi).toBe(false);
    expect(config.notificationUrl).toBe("http://notify.test/notify");
    expect(config.notificationToken).toBe("notify-secret");
    expect(config.notificationTargetType).toBe("private");
    expect(config.notificationTargetId).toBe("123");
  });

  test("rejects invalid ports", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow("PORT must be an integer");
    expect(() => loadConfig({ CODEX_WEB_FRONTEND_PORT: "abc" })).toThrow(
      "CODEX_WEB_FRONTEND_PORT must be an integer"
    );
    expect(() => loadConfig({ CODEX_APP_SERVER_PORT: "70000" })).toThrow(
      "CODEX_APP_SERVER_PORT must be between 1 and 65535"
    );
  });
});
