import type { CreateCustomerSchema, CreateSaleSchema } from "@universal-pos/shared";
import type { z } from "zod";

export interface OfflineCatalogVariant {
  id: string;
  sku: string;
  optionValues: Record<string, string>;
  retailPriceMinor: number;
  costPriceMinor: number;
  barcodes: string[];
  stockQty: number;
}

export interface OfflineCatalogProduct {
  id: string;
  name: string;
  sku: string;
  categoryId?: string | null;
  taxClassId?: string | null;
  taxRatePercent: number;
  variants: OfflineCatalogVariant[];
  barcodes: string[];
  updatedAt: string;
  isActive: boolean;
}

export interface OfflineStock {
  variantId: string;
  stockQty: number;
  updatedAt: string;
}

export interface OfflineCustomer {
  id: string;
  name: string;
  phone: string;
  points?: number;
  updatedAt: string;
}

export interface OfflineSetting {
  key: string;
  value: any;
}

export interface OfflineSession {
  key: string;
  value: any;
}

export type OutboxType = "sale" | "customer";
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed";

export type CreateSalePayload = z.infer<typeof CreateSaleSchema>;
export type CreateCustomerPayload = z.infer<typeof CreateCustomerSchema>;

export interface OfflineOutboxItem {
  id: string;
  idempotencyKey: string;
  type: OutboxType;
  payload: CreateSalePayload | CreateCustomerPayload;
  status: OutboxStatus;
  attemptCount: number;
  nextAttemptAt: number;
  lastError?: string | null;
  createdAt: number;
  syncedAt?: number | null;
}

export interface OfflineLocalSale {
  invoiceNumber: string;
  saleData: CreateSalePayload;
  createdAt: number;
}

export interface OfflineSyncLog {
  id?: number;
  timestamp: number;
  event: string;
  details?: any;
}

export interface OfflineReviewFlag {
  id: string;
  saleId: string;
  flagType: string;
  resolved: boolean;
  createdAt: string;
}

export interface OfflineCounter {
  registerId: string;
  date: string; // YYYYMMDD in tenant timezone
  lastSeq: number;
}

export interface PosCatalogResponse {
  products: OfflineCatalogProduct[];
  variants?: any[];
  categories: { id: string; name: string }[];
  taxClasses: { id: string; name: string; ratePercent: number }[];
  catalogVersion: number;
  serverTime: string;
  cursor?: string | null;
}
