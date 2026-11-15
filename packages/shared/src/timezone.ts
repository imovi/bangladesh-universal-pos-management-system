/**
 * Pure timezone and business date utilities for multi-tenant POS.
 * Defaults to "Asia/Dhaka" (UTC+6, no DST).
 */

function normalizeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return timeZone;
  } catch {
    return "Asia/Dhaka";
  }
}

export function formatDateKey(date: Date, rawTimeZone = "Asia/Dhaka"): string {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const yy = parts.find((p) => p.type === "year")?.value || "00";
  const mm = parts.find((p) => p.type === "month")?.value || "01";
  const dd = parts.find((p) => p.type === "day")?.value || "01";
  return `${yy}${mm}${dd}`;
}

export function formatBusinessDate(date: Date, rawTimeZone = "Asia/Dhaka"): string {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value || "1970";
  const month = parts.find((p) => p.type === "month")?.value || "01";
  const day = parts.find((p) => p.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const utcDate = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const tzDate = new Date(date.toLocaleString("en-US", { timeZone }));
  return tzDate.getTime() - utcDate.getTime();
}

function parseCalendarDateToUtc(dateStr: string, isEndOfDay: boolean, timeZone: string): Date {
  if (dateStr.includes("T") || dateStr.includes("Z")) {
    return new Date(dateStr);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  const hour = isEndOfDay ? 23 : 0;
  const minute = isEndOfDay ? 59 : 0;
  const second = isEndOfDay ? 59 : 0;
  const millisecond = isEndOfDay ? 999 : 0;

  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, second, millisecond));
  const offsetMs = getTimezoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offsetMs);
}

export function parseDateFilterRange(
  startDate?: string,
  endDate?: string,
  rawTimeZone = "Asia/Dhaka",
): { gte?: Date; lte?: Date } {
  const timeZone = normalizeTimeZone(rawTimeZone);
  const result: { gte?: Date; lte?: Date } = {};
  if (startDate) {
    result.gte = parseCalendarDateToUtc(startDate, false, timeZone);
  }
  if (endDate) {
    result.lte = parseCalendarDateToUtc(endDate, true, timeZone);
  }
  return result;
}
