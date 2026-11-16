import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format money in BDT minor units (poisha) to Taka string
 * e.g. 150000 -> ৳ 1,500.00
 */
export function formatMoney(minorUnits: number | bigint | null | undefined, currency = "BDT"): string {
  if (minorUnits === null || minorUnits === undefined) return "—";
  const num = Number(minorUnits) / 100;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "BDT" ? `৳ ${formatted}` : `${currency} ${formatted}`;
}

/**
 * Format date strictly as DD/MM/YYYY in tenant timezone (default Asia/Dhaka)
 * e.g. 16/11/2026
 */
export function formatDate(
  dateStringOrDate: string | Date | null | undefined,
  timeZone = "Asia/Dhaka"
): string {
  if (!dateStringOrDate) return "—";
  const d = typeof dateStringOrDate === "string" ? new Date(dateStringOrDate) : dateStringOrDate;
  if (isNaN(d.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(d);

  const day = parts.find((p) => p.type === "day")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const year = parts.find((p) => p.type === "year")?.value;
  return `${day}/${month}/${year}`;
}

/**
 * Format date and time strictly as DD/MM/YYYY, h:mm A in tenant timezone (default Asia/Dhaka)
 * e.g. 16/11/2026, 9:14 AM
 */
export function formatDateTime(
  dateStringOrDate: string | Date | null | undefined,
  timeZone = "Asia/Dhaka"
): string {
  if (!dateStringOrDate) return "—";
  const d = typeof dateStringOrDate === "string" ? new Date(dateStringOrDate) : dateStringOrDate;
  if (isNaN(d.getTime())) return "—";

  const dateFormatted = formatDate(d, timeZone);
  const timeFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);

  return `${dateFormatted}, ${timeFormatted}`;
}
