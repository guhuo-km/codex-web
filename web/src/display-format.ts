export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs)) return "0ms";
  const wholeMs = Math.max(0, Math.floor(durationMs));
  if (wholeMs < 1000) return `${wholeMs}ms`;

  const totalTenths = Math.round(wholeMs / 100);
  const tenthsPerSecond = 10;
  const tenthsPerMinute = 60 * tenthsPerSecond;
  const tenthsPerHour = 60 * tenthsPerMinute;
  const tenthsPerDay = 24 * tenthsPerHour;

  let remaining = totalTenths;
  const days = Math.floor(remaining / tenthsPerDay);
  remaining -= days * tenthsPerDay;
  const hours = Math.floor(remaining / tenthsPerHour);
  remaining -= hours * tenthsPerHour;
  const minutes = Math.floor(remaining / tenthsPerMinute);
  remaining -= minutes * tenthsPerMinute;

  const secondValue = remaining / tenthsPerSecond;
  const seconds = secondValue % 1 === 0 ? String(secondValue) : secondValue.toFixed(1);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (seconds !== "0" || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(" ");
}

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value) > 1000) return `${(value / 1000).toFixed(1)}K`;
  return new Intl.NumberFormat("en-US").format(value);
}
