import { PrismaClient, Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { formatDateKey } from "@universal-pos/shared";

/**
 * Common helpers for Returns & Exchanges Engine.
 * Formulated with integer minor units (poisha).
 */

/**
 * Locks sale item rows using transaction-scoped advisory locks.
 * Crucial: Items are sorted alphanumerically by UUID to guarantee
 * deterministic lock acquisition order across concurrent transactions,
 * preventing PostgreSQL deadlocks when two transactions touch multiple items.
 *
 * Why advisory locks instead of SELECT ... FOR UPDATE?
 * 1. sale_items rows are immutable historical receipts. Row-level locks on
 *    historical rows can interfere with read-heavy reporting or foreign key joins.
 * 2. pg_advisory_xact_lock(hashtext(itemId)) operates in memory, scoped strictly
 *    to the transaction lifecycle, releasing automatically on COMMIT/ROLLBACK.
 */
export async function lockSaleItems(
  tx: PrismaClient | Prisma.TransactionClient,
  saleItemIds: string[],
): Promise<void> {
  const sortedIds = Array.from(new Set(saleItemIds)).sort();
  for (const itemId of sortedIds) {
    await (tx as any).$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${itemId}::text));
    `;
  }
}

/**
 * Generates sequential return numbers in format REG01-R-YYMMDD-XXXX
 * matching invoice number convention and Phase 1C prompt.
 */
export async function generateReturnNumber(
  tenantId: string,
  registerId: string,
  tx: Prisma.TransactionClient,
  timeZone = "Asia/Dhaka",
): Promise<string> {
  const reg = await (tx as any).register.findUnique({
    where: { id: registerId },
    select: { code: true },
  });
  const regCode = reg?.code || "REG01";
  const dateKey = formatDateKey(new Date(), timeZone);

  await (tx as any).$executeRaw`
    INSERT INTO return_counters (id, tenant_id, register_id, date_key, last_seq, updated_at)
    VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${dateKey}, 0, NOW())
    ON CONFLICT (tenant_id, register_id, date_key) DO NOTHING;
  `;

  const counters = await (tx as any).$queryRaw<{ last_seq: number }[]>`
    SELECT last_seq FROM return_counters
    WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey}
    FOR UPDATE;
  `;
  const nextSeq = (counters[0]?.last_seq || 0) + 1;
  await (tx as any).$executeRaw`
    UPDATE return_counters SET last_seq = ${nextSeq}, updated_at = NOW()
    WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey};
  `;

  return `${regCode}-R-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
}

/**
 * Generates sequential invoice numbers in format REG01-YYMMDD-XXXX
 */
export async function generateInvoiceNumber(
  tenantId: string,
  registerId: string,
  tx: Prisma.TransactionClient,
  timeZone = "Asia/Dhaka",
): Promise<string> {
  const reg = await (tx as any).register.findUnique({
    where: { id: registerId },
    select: { code: true },
  });
  const regCode = reg?.code || "REG";
  const dateKey = formatDateKey(new Date(), timeZone);

  await (tx as any).$executeRaw`
    INSERT INTO receipt_counters (id, tenant_id, register_id, date_key, last_seq, updated_at)
    VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${dateKey}, 0, NOW())
    ON CONFLICT (tenant_id, register_id, date_key) DO NOTHING;
  `;

  const counters = await (tx as any).$queryRaw<{ last_seq: number }[]>`
    SELECT last_seq FROM receipt_counters
    WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey}
    FOR UPDATE;
  `;
  const nextSeq = (counters[0]?.last_seq || 0) + 1;
  await (tx as any).$executeRaw`
    UPDATE receipt_counters SET last_seq = ${nextSeq}, updated_at = NOW()
    WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey};
  `;

  return `${regCode}-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
}
