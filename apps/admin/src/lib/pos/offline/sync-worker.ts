import { db, PosOfflineDatabase } from "./db";
import type { OfflineOutboxItem } from "./types";

export interface SyncWorkerConfig {
  baseUrl?: string;
  token?: string;
  database?: PosOfflineDatabase;
  customSender?: (item: OfflineOutboxItem) => Promise<{ status: number; body?: any; error?: string }>;
  onStatusChange?: (stats: { pending: number; syncing: number; synced: number; failed: number }) => void;
  forceImmediate?: boolean;
}

let isSyncRunning = false;
let syncWorkerTimer: any = null;

/**
 * Calculate exponential backoff with jitter in ms.
 * Base: 2000ms (2s), multiplied by 2^attemptCount, capped at 300_000ms (5 min), + jitter up to 1000ms.
 */
export function calculateBackoffMs(attemptCount: number, randomJitterMs = Math.random() * 1000): number {
  const baseMs = 2000;
  const maxMs = 300_000;
  const exponential = baseMs * Math.pow(2, Math.max(0, attemptCount));
  const backoff = Math.min(maxMs, exponential);
  return Math.round(backoff + randomJitterMs);
}

/**
 * Send an outbox item via API.
 */
async function defaultSender(
  item: OfflineOutboxItem,
  baseUrl: string,
  token?: string
): Promise<{ status: number; body?: any; error?: string }> {
  const endpoint = item.type === "sale" ? "/sales" : "/customers";
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Idempotency-Key": item.idempotencyKey,
    "x-idempotency-key": item.idempotencyKey,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(item.payload),
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body
    }

    return {
      status: res.status,
      body,
      error: !res.ok ? (body?.message || `HTTP ${res.status}`) : undefined,
    };
  } catch (err: any) {
    return {
      status: 0,
      error: err.message || "Network Error",
    };
  }
}

/**
 * Process pending items in outbox in FIFO order.
 * Prevents concurrent runs using isSyncRunning lock.
 */
export async function runSync(config: SyncWorkerConfig = {}): Promise<{
  processed: number;
  synced: number;
  failed: number;
  retried: number;
}> {
  if (isSyncRunning) {
    return { processed: 0, synced: 0, failed: 0, retried: 0 };
  }

  isSyncRunning = true;
  const targetDb = config.database || db;
  const baseUrl = config.baseUrl || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

  let processed = 0;
  let synced = 0;
  let failed = 0;
  let retried = 0;

  try {
    const now = Date.now();

    // Fetch items ordered by createdAt ascending
    const candidates = await targetDb.outbox
      .orderBy("createdAt")
      .filter((item) => item.status === "pending" && (config.forceImmediate ? true : item.nextAttemptAt <= now))
      .toArray();

    for (const item of candidates) {
      processed++;

      // Mark status as syncing
      await targetDb.outbox.update(item.id, { status: "syncing" });

      const sender = config.customSender
        ? config.customSender(item)
        : defaultSender(item, baseUrl, config.token);

      const result = await sender;

      // 1. Success (2xx) or Idempotent conflict replay (409)
      const isSuccess = result.status >= 200 && result.status < 300;
      const isIdempotentConflict =
        result.status === 409 &&
        (result.body?.code === "OFFLINE_NUMBER_TAKEN" || result.body?.code === "IDEMPOTENCY_KEY_REUSED");

      if (isSuccess || isIdempotentConflict) {
        await targetDb.outbox.update(item.id, {
          status: "synced",
          syncedAt: Date.now(),
          lastError: null,
        });

        const serverInv = result.body?.data?.invoiceNumber || result.body?.invoiceNumber;
        if (serverInv && item.type === "sale") {
          try {
            await targetDb.localSales.put({
              invoiceNumber: serverInv,
              saleData: { ...(item.payload as any), invoiceNumber: serverInv },
              createdAt: Date.now(),
            });
          } catch {}
        }

        synced++;
      } else if (result.status >= 400 && result.status < 500 && result.status !== 408 && result.status !== 429) {
        // 2. Fatal client error (e.g. 400, 422 TOTALS_MISMATCH, etc.)
        // Never retry automatically to prevent poisoning the queue!
        console.error('[SYNC FAILED]', result.status, result.error, JSON.stringify(result.body));
        await targetDb.outbox.update(item.id, {
          status: "failed",
          lastError: result.error || `Client Error ${result.status}`,
        });
        failed++;
      } else {
        // 3. Network offline (status 0) or 5xx server error or 429 rate limit
        // Retry with exponential backoff and jitter
        const nextAttemptCount = item.attemptCount + 1;
        const delayMs = calculateBackoffMs(nextAttemptCount);
        await targetDb.outbox.update(item.id, {
          status: "pending",
          attemptCount: nextAttemptCount,
          nextAttemptAt: Date.now() + delayMs,
          lastError: result.error || "Network error",
        });
        retried++;
      }
    }

    if (config.onStatusChange) {
      const stats = await getOutboxStats(targetDb);
      config.onStatusChange(stats);
    }
  } finally {
    isSyncRunning = false;
  }

  return { processed, synced, failed, retried };
}

export async function getOutboxStats(database?: PosOfflineDatabase): Promise<{
  pending: number;
  syncing: number;
  synced: number;
  failed: number;
}> {
  const targetDb = database || db;
  const items = await targetDb.outbox.toArray();
  let pending = 0;
  let syncing = 0;
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    if (item.status === "pending") pending++;
    else if (item.status === "syncing") syncing++;
    else if (item.status === "synced") synced++;
    else if (item.status === "failed") failed++;
  }

  return { pending, syncing, synced, failed };
}

/**
 * Start background sync interval (checks every 5 seconds).
 */
export function startSyncWorker(config: SyncWorkerConfig = {}, intervalMs = 5000): void {
  if (syncWorkerTimer) {
    clearInterval(syncWorkerTimer);
  }
  syncWorkerTimer = setInterval(() => {
    runSync(config).catch((err) => {
      console.warn("[SyncWorker] Error in sync run:", err);
    });
  }, intervalMs);
}

/**
 * Stop background sync interval.
 */
export function stopSyncWorker(): void {
  if (syncWorkerTimer) {
    clearInterval(syncWorkerTimer);
    syncWorkerTimer = null;
  }
}
