import { describe, expect, test } from "vitest";
import { appendTurnWindow, followLatestTurnWindow, latestTurnWindow, prependTurnWindow } from "../web/src/turn-window.js";

describe("turn window", () => {
  test("starts from the latest turns", () => {
    expect(latestTurnWindow(100, 20)).toEqual({ start: 80, end: 100 });
    expect(latestTurnWindow(8, 20)).toEqual({ start: 0, end: 8 });
  });

  test("prepends older turns and trims newer tail when cache is full", () => {
    expect(prependTurnWindow({ start: 80, end: 100 }, 100, 10, 25)).toEqual({ start: 70, end: 95 });
  });

  test("appends newer turns and trims older head when cache is full", () => {
    expect(appendTurnWindow({ start: 70, end: 95 }, 100, 10, 25)).toEqual({ start: 75, end: 100 });
  });

  test("follows new latest turns only when the window was already at latest", () => {
    expect(followLatestTurnWindow({ start: 80, end: 100 }, 100, 103, 25)).toEqual({ start: 83, end: 103 });
    expect(followLatestTurnWindow({ start: 60, end: 85 }, 100, 103, 25)).toEqual({ start: 60, end: 85 });
  });

  test("grows an undersized latest window up to the minimum visible size", () => {
    expect(followLatestTurnWindow({ start: 0, end: 1 }, 1, 2, 60, 20)).toEqual({ start: 0, end: 2 });
  });
});
