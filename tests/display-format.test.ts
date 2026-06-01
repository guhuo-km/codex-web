import { describe, expect, test } from "vitest";
import { formatDuration, formatTokenCount } from "../web/src/display-format.js";

describe("display formatting", () => {
  test("formats durations with only non-zero larger units", () => {
    expect(formatDuration(30_000)).toBe("30s");
    expect(formatDuration(30_400)).toBe("30.4s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_690_500)).toBe("1h 1m 30.5s");
    expect(formatDuration(93_690_500)).toBe("1d 2h 1m 30.5s");
  });

  test("keeps millisecond durations compact", () => {
    expect(formatDuration(250)).toBe("250ms");
  });

  test("formats token counts as K above one thousand", () => {
    expect(formatTokenCount(999)).toBe("999");
    expect(formatTokenCount(1_000)).toBe("1,000");
    expect(formatTokenCount(1_250)).toBe("1.3K");
    expect(formatTokenCount(12_000)).toBe("12.0K");
  });
});
