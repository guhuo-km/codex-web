import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/approval-routes.test.ts",
      "tests/codex-bridge.test.ts",
      "tests/codex-normalizers.test.ts",
      "tests/file-change-display.test.ts",
      "tests/http-routes.test.ts",
      "tests/session-history.test.ts",
      "tests/thread-history.test.ts"
    ],
    restoreMocks: true
  }
});
