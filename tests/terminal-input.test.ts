import { describe, expect, test } from "vitest";
import { shouldDropOverlappingTerminalInput } from "../web/src/components/ChatPane.js";

describe("terminal input overlap filtering", () => {
  test("drops an immediate repeated tail character after a short burst", () => {
    expect(shouldDropOverlappingTerminalInput(
      { input: "op", at: 100 },
      "p",
      100.4
    )).toBe(true);
  });

  test("keeps paste and normal follow-up typing", () => {
    expect(shouldDropOverlappingTerminalInput(
      { input: "npm run build", at: 100 },
      "d",
      100.4
    )).toBe(false);
    expect(shouldDropOverlappingTerminalInput(
      { input: "op", at: 100 },
      "p",
      140
    )).toBe(false);
    expect(shouldDropOverlappingTerminalInput(
      { input: "p", at: 100 },
      "p",
      100.4
    )).toBe(false);
  });
});
