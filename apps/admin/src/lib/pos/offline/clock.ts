import { db } from "./db";

let memoryServerOffsetMs = 0;

/**
 * Update the stored clock offset between server and client device.
 * serverOffsetMs = serverTime - clientDeviceTime
 */
export async function updateServerClockOffset(serverTimeIsoOrMs: string | number): Promise<number> {
  const serverMs =
    typeof serverTimeIsoOrMs === "string"
      ? new Date(serverTimeIsoOrMs).getTime()
      : serverTimeIsoOrMs;
  const clientMs = Date.now();
  memoryServerOffsetMs = serverMs - clientMs;

  try {
    await db.settings.put({
      key: "serverClockOffsetMs",
      value: memoryServerOffsetMs,
    });
  } catch {
    // Ignore storage failure in pure unit test or restricted environment
  }

  return memoryServerOffsetMs;
}

/**
 * Get current server offset in ms.
 */
export async function getServerClockOffset(): Promise<number> {
  if (memoryServerOffsetMs !== 0) {
    return memoryServerOffsetMs;
  }
  try {
    const setting = await db.settings.get("serverClockOffsetMs");
    if (setting && typeof setting.value === "number") {
      memoryServerOffsetMs = setting.value;
    }
  } catch {
    // fallback to memory
  }
  return memoryServerOffsetMs;
}

/**
 * Get estimated current server time in ms.
 */
export function getEstimatedServerTime(offsetMs: number = memoryServerOffsetMs): number {
  return Date.now() + offsetMs;
}

/**
 * Clamp a sale timestamp within shift boundaries.
 * If occurredAt < openedAt -> clamped to openedAt.
 * If occurredAt > closedAt -> clamped to closedAt.
 * If occurredAt > estimatedServerNow -> clamped to estimatedServerNow (cannot be in future).
 */
export function clampSaleTime(
  occurredAtMs: number,
  shiftOpenedAtMs: number,
  shiftClosedAtMs?: number | null,
  maxAllowedMs?: number
): number {
  let clamped = occurredAtMs;

  if (clamped < shiftOpenedAtMs) {
    clamped = shiftOpenedAtMs;
  }

  if (shiftClosedAtMs && clamped > shiftClosedAtMs) {
    clamped = shiftClosedAtMs;
  }

  if (maxAllowedMs && clamped > maxAllowedMs) {
    clamped = maxAllowedMs;
  }

  return clamped;
}
