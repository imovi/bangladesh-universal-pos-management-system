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
 * Format date in Bangladesh local time
 */
export function formatDate(dateStringOrDate: string | Date | null | undefined): string {
  if (!dateStringOrDate) return "—";
  const d = new Date(dateStringOrDate);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format date and time in Bangladesh local time
 */
export function formatDateTime(dateStringOrDate: string | Date | null | undefined): string {
  if (!dateStringOrDate) return "—";
  const d = new Date(dateStringOrDate);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
