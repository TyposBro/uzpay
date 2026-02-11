/**
 * Tashkent (GMT+5) timestamp formatters for Paynet integration.
 * Uses Intl.DateTimeFormat — supported in all modern JS runtimes.
 */

function getPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): string {
  return parts.find((p) => p.type === type)?.value ?? "";
}

/**
 * Paynet GetInformation / PerformTransaction timestamp format.
 * Format: "YYYY-MM-DD HH:mm:ss" in Asia/Tashkent timezone.
 */
export function getTashkentTimestamp(date?: Date): string {
  const d = date ?? new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const y = getPart(parts, "year");
  const mo = getPart(parts, "month");
  const da = getPart(parts, "day");
  const h = getPart(parts, "hour");
  const mi = getPart(parts, "minute");
  const s = getPart(parts, "second");

  return `${y}-${mo}-${da} ${h}:${mi}:${s}`;
}

/**
 * Paynet CheckTransaction timestamp format.
 * Format: "EEE MMM dd HH:mm:ss UZT yyyy" (e.g. "Tue Dec 30 10:29:03 UZT 2025")
 */
export function getTashkentCheckTimestamp(date?: Date): string {
  const d = date ?? new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tashkent",
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const dayName = getPart(parts, "weekday");
  const monthName = getPart(parts, "month");
  const da = getPart(parts, "day");
  const h = getPart(parts, "hour");
  const mi = getPart(parts, "minute");
  const s = getPart(parts, "second");
  const y = getPart(parts, "year");

  return `${dayName} ${monthName} ${da} ${h}:${mi}:${s} UZT ${y}`;
}
