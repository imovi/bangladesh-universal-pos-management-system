import Dexie, { type Table } from "dexie";
import type {
  OfflineCatalogProduct,
  OfflineCounter,
  OfflineCustomer,
  OfflineLocalSale,
  OfflineOutboxItem,
  OfflineReviewFlag,
  OfflineSession,
  OfflineSetting,
  OfflineStock,
  OfflineSyncLog,
} from "./types";

export class PosOfflineDatabase extends Dexie {
  catalog!: Table<OfflineCatalogProduct, string>;
  stock!: Table<OfflineStock, string>;
  customers!: Table<OfflineCustomer, string>;
  settings!: Table<OfflineSetting, string>;
  session!: Table<OfflineSession, string>;
  outbox!: Table<OfflineOutboxItem, string>;
  localSales!: Table<OfflineLocalSale, string>;
  syncLog!: Table<OfflineSyncLog, number>;
  reviewFlags!: Table<OfflineReviewFlag, string>;
  counters!: Table<OfflineCounter, [string, string]>;

  constructor(dbName = "UniversalPosOfflineDB") {
    super(dbName);

    this.version(1).stores({
      catalog: "id, sku, categoryId, *barcodes, updatedAt",
      stock: "variantId, updatedAt",
      customers: "id, phone, name, updatedAt",
      settings: "key",
      session: "key",
      outbox: "id, idempotencyKey, type, status, nextAttemptAt, createdAt",
      localSales: "id, invoiceNumber, offlineInvoiceNumber, shiftId, createdAt",
      syncLog: "++id, timestamp, event",
      reviewFlags: "id, saleId, flagType, resolved, createdAt",
      counters: "[registerId+date], registerId, date",
    });
  }
}

export const db = new PosOfflineDatabase();

/**
 * Request persistent storage to protect against automatic browser cache eviction.
 * Logs whether persistent storage was granted.
 */
export async function initPersistentStorage(): Promise<{
  supported: boolean;
  persisted: boolean;
}> {
  if (typeof window === "undefined" || !navigator.storage || !navigator.storage.persist) {
    return { supported: false, persisted: false };
  }

  try {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      return { supported: true, persisted: true };
    }
    const granted = await navigator.storage.persist();
    if (granted) {
      console.info("[UniversalPOS] Storage persistence granted by browser.");
    } else {
      console.warn("[UniversalPOS] Storage persistence NOT granted; data may be evicted under storage pressure.");
    }
    return { supported: true, persisted: granted };
  } catch (err) {
    console.warn("[UniversalPOS] Failed to request storage persistence:", err);
    return { supported: true, persisted: false };
  }
}
