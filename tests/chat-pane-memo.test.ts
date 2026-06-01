import { describe, expect, test } from "vitest";
import { isMemoizedChatPane } from "../web/src/components/ChatPane.js";

describe("ChatPane memoization", () => {
  test("exports a memoized chat pane so composer typing does not rerender the message list", () => {
    expect(isMemoizedChatPane).toBe(true);
  });
});
