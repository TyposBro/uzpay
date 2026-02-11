/**
 * Tashkent (GMT+5) timestamp formatters for Paynet integration.
 */

function getTashkentDate(date?: Date): Date {
  const now = date ?? new Date();
  const tashkentOffset = 5 * 60; // minutes
  const utcOffset = now.getTimezoneOffset(); // minutes
  return new Date(now.getTime() + (utcOffset + tashkentOffset) * 60000);
}

/**
 * Paynet GetInformation / PerformTransaction timestamp format.
 * Format: "YYYY-MM-DD HH:mm:ss" in GMT+5
 */
export function getTashkentTimestamp(date?: Date): string {
  const t = getTashkentDate(date);
  const y = t.getFullYear();
  const mo = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  const h = String(t.getHours()).padStart(2, "0");
  const mi = String(t.getMinutes()).padStart(2, "0");
  const s = String(t.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

/**
 * Paynet CheckTransaction timestamp format.
 * Format: "EEE MMM dd HH:mm:ss UZT yyyy" (e.g. "Tue Dec 30 10:29:03 UZT 2025")
 */
export function getTashkentCheckTimestamp(date?: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const t = getTashkentDate(date);
  const dayName = days[t.getDay()];
  const monthName = months[t.getMonth()];
  const d = String(t.getDate()).padStart(2, "0");
  const h = String(t.getHours()).padStart(2, "0");
  const mi = String(t.getMinutes()).padStart(2, "0");
  const s = String(t.getSeconds()).padStart(2, "0");
  const y = t.getFullYear();

  return `${dayName} ${monthName} ${d} ${h}:${mi}:${s} UZT ${y}`;
}
