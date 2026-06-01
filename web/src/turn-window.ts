export interface TurnWindow {
  start: number;
  end: number;
}

export function latestTurnWindow(turnCount: number, size: number): TurnWindow {
  const safeSize = Math.max(0, Math.min(turnCount, Math.floor(size)));
  return { start: Math.max(0, turnCount - safeSize), end: turnCount };
}

export function normalizeTurnWindow(turnCount: number, window: TurnWindow, fallbackSize: number): TurnWindow {
  if (turnCount <= 0) return { start: 0, end: 0 };
  const start = clamp(Math.floor(window.start), 0, turnCount);
  const end = clamp(Math.floor(window.end), start, turnCount);
  if (end > start) return { start, end };
  return latestTurnWindow(turnCount, fallbackSize);
}

export function prependTurnWindow(window: TurnWindow, turnCount: number, batchSize: number, cacheLimit: number): TurnWindow {
  const normalized = normalizeTurnWindow(turnCount, window, cacheLimit);
  const start = Math.max(0, normalized.start - batchSize);
  const end = Math.min(turnCount, Math.max(normalized.end, start + 1));
  return enforceCacheLimit({ start, end }, cacheLimit, "tail");
}

export function appendTurnWindow(window: TurnWindow, turnCount: number, batchSize: number, cacheLimit: number): TurnWindow {
  const normalized = normalizeTurnWindow(turnCount, window, cacheLimit);
  const end = Math.min(turnCount, normalized.end + batchSize);
  const start = Math.max(0, Math.min(normalized.start, end - 1));
  return enforceCacheLimit({ start, end }, cacheLimit, "head");
}

export function followLatestTurnWindow(window: TurnWindow, previousTurnCount: number, nextTurnCount: number, cacheLimit: number, minimumSize = 1): TurnWindow {
  if (window.end < previousTurnCount) {
    return enforceCacheLimit(normalizeTurnWindow(nextTurnCount, window, cacheLimit), cacheLimit, "tail");
  }
  const size = Math.min(cacheLimit, Math.max(1, Math.floor(minimumSize), window.end - window.start));
  return latestTurnWindow(nextTurnCount, size);
}

function enforceCacheLimit(window: TurnWindow, cacheLimit: number, trimSide: "head" | "tail"): TurnWindow {
  const limit = Math.max(1, Math.floor(cacheLimit));
  const size = window.end - window.start;
  if (size <= limit) return window;
  if (trimSide === "head") {
    return { start: window.end - limit, end: window.end };
  }
  return { start: window.start, end: window.start + limit };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
