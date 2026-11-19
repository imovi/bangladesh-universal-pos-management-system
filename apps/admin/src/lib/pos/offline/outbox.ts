import { db, PosOfflineDatabase } from "./db";
import type {
  CreateCustomerPayload,
  CreateSalePayload,
  OfflineOutboxItem,
} from "./types";

export interface EnqueueSaleResult {
  outboxId: string;
  invoiceNumber: string;
}

export async function enqueueSale(
  salePayload: CreateSalePayload,
  database?: PosOfflineDatabase
): Promise<EnqueueSaleResult> {
  const targetDb = database || db;
  const outboxId = crypto.randomUUID();
  const saleId = salePayload.id || crypto.randomUUID();
  const idempotencyKey = salePayload.id || saleId;
  const invoiceNumber = salePayload.invoiceNumber;

  if (!invoiceNumber) {
    throw new Error("Cannot enqueue sale without invoiceNumber");
  }

  const outboxItem: OfflineOutboxItem = {
    id: outboxId,
    idempotencyKey,
    type: "sale",
    payload: { ...salePayload, id: saleId },
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  };

  await targetDb.transaction(
    "rw",
    [targetDb.outbox, targetDb.localSales, targetDb.stock, targetDb.catalog],
    async () => {
      // 1. Save outbox record
      await targetDb.outbox.put(outboxItem);

      // 2. Save local sale copy (keyed by id to prevent duplicate rows)
      await targetDb.localSales.put({
        id: saleId,
        invoiceNumber,
        offlineInvoiceNumber: invoiceNumber,
        serverInvoiceNumber: null,
        shiftId: salePayload.shiftId,
        saleData: { ...salePayload, id: saleId },
        status: "unsynced",
        createdAt: Date.now(),
      });

      // 3. Decrement local stock for each line item
      for (const item of salePayload.items) {
        const currentStock = await targetDb.stock.get(item.variantId);
        const newQty = (currentStock?.stockQty ?? 0) - item.quantity;
        await targetDb.stock.put({
          variantId: item.variantId,
          stockQty: newQty,
          updatedAt: new Date().toISOString(),
        });

        // Also update nested variant in catalog if product exists
        const prodId = (item as any).productId;
        if (prodId) {
          const product = await targetDb.catalog.get(prodId);
          if (product && product.variants) {
            const vIndex = product.variants.findIndex((v) => v.id === item.variantId);
            if (vIndex >= 0) {
              product.variants[vIndex].stockQty = newQty;
              const vAny = product.variants[vIndex] as any;
              if (vAny.stockLevels && Array.isArray(vAny.stockLevels)) {
                for (const sl of vAny.stockLevels) {
                  if (!sl.branchId || sl.branchId === salePayload.branchId) {
                    sl.qty = String(newQty);
                  }
                }
              } else {
                vAny.stockLevels = [{ branchId: salePayload.branchId, qty: String(newQty) }];
              }
              await targetDb.catalog.put(product);
            }
          }
        }
      }
    }
  );

  return { outboxId, invoiceNumber };
}

export async function enqueueCustomer(
  customerPayload: CreateCustomerPayload & { id?: string },
  database?: PosOfflineDatabase
): Promise<{ outboxId: string; customerId: string }> {
  const targetDb = database || db;
  const outboxId = crypto.randomUUID();
  const customerId = customerPayload.id || crypto.randomUUID();
  const idempotencyKey = customerId;
  const payloadWithId = { ...customerPayload, id: customerId };

  const outboxItem: OfflineOutboxItem = {
    id: outboxId,
    idempotencyKey,
    type: "customer",
    payload: payloadWithId,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  };

  await targetDb.transaction(
    "rw",
    [targetDb.outbox, targetDb.customers],
    async () => {
      await targetDb.outbox.put(outboxItem);
      await targetDb.customers.put({
        id: customerId,
        name: customerPayload.name,
        phone: customerPayload.phone,
        updatedAt: new Date().toISOString(),
      });
    }
  );

  return { outboxId, customerId };
}
