import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import * as crypto from "crypto";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateSaleReturnDto,
  CreateSaleExchangeDto,
  ListReturnsQueryDto,
  calculateLineReturnRefund,
  parseQuantityThousandths,
  calculateShiftCashTotals,
  calculateSaleTotals,
  roundHalfUp,
  formatDateKey,
} from "@universal-pos/shared";
import { enforceDiscountAndOverrideLimits } from "./sales-discount.helper.js";

@Injectable()
export class ReturnsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly systemDb: SystemDbService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  private async generateReturnNumber(
    tenantId: string,
    registerId: string,
    tx: Prisma.TransactionClient,
    timeZone = "Asia/Dhaka",
  ): Promise<string> {
    const reg = await tx.register.findUnique({ where: { id: registerId } });
    const regCode = reg?.code || "REG01";
    const dateKey = formatDateKey(new Date(), timeZone);

    await tx.$executeRaw`
      INSERT INTO return_counters (id, tenant_id, register_id, date_key, last_seq, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${dateKey}, 0, NOW())
      ON CONFLICT (tenant_id, register_id, date_key) DO NOTHING;
    `;

    const counters = await tx.$queryRaw<{ last_seq: number }[]>`
      SELECT last_seq FROM return_counters
      WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey}
      FOR UPDATE;
    `;
    const nextSeq = (counters[0]?.last_seq || 0) + 1;
    await tx.$executeRaw`
      UPDATE return_counters SET last_seq = ${nextSeq}, updated_at = NOW()
      WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey};
    `;
    return `${regCode}-R-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
  }

  private async generateInvoiceNumber(
    tenantId: string,
    registerId: string,
    tx: Prisma.TransactionClient,
    timeZone = "Asia/Dhaka",
  ): Promise<string> {
    const reg = await tx.register.findUnique({ where: { id: registerId } });
    const regCode = reg?.code || "REG";
    const dateKey = formatDateKey(new Date(), timeZone);

    await tx.$executeRaw`
      INSERT INTO receipt_counters (id, tenant_id, register_id, date_key, last_seq, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${registerId}::uuid, ${dateKey}, 0, NOW())
      ON CONFLICT (tenant_id, register_id, date_key) DO NOTHING;
    `;

    const counters = await tx.$queryRaw<{ last_seq: number }[]>`
      SELECT last_seq FROM receipt_counters
      WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey}
      FOR UPDATE;
    `;
    const nextSeq = (counters[0]?.last_seq || 0) + 1;
    await tx.$executeRaw`
      UPDATE receipt_counters SET last_seq = ${nextSeq}, updated_at = NOW()
      WHERE tenant_id = ${tenantId}::uuid AND register_id = ${registerId}::uuid AND date_key = ${dateKey};
    `;
    return `${regCode}-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
  }

  private async getTenantSettings(tenantId: string) {
    const tenant = await this.systemDb.findTenantById(tenantId);
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    return {
      pricesIncludeTax: (settings.prices_include_tax as boolean) ?? true,
      timeZone: (settings.timezone as string) || "Asia/Dhaka",
      returnWindowDays: Number(settings.return_window_days ?? 7),
    };
  }

  async createReturn(
    tenantId: string,
    saleId: string,
    dto: CreateSaleReturnDto,
    userId: string,
    ip?: string,
    user?: { isOwner?: boolean; permissions?: string[] },
  ) {
    const payloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(dto))
      .digest("hex");

    const { timeZone, returnWindowDays } = await this.getTenantSettings(tenantId);

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Idempotency Check
      const existing = await tx.saleReturn.findUnique({
        where: { id: dto.id },
        include: { items: true },
      });
      if (existing) {
        if (existing.tenantId !== tenantId) throw new NotFoundException("Return not found");
        if (existing.requestPayloadHash === payloadHash) {
          return { ...existing, isDuplicate: true };
        }
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: `Return ${dto.id} already exists with different payload`,
        });
      }

      // 2. Load and validate original sale
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: {
          items: true,
          returns: { include: { items: true } },
        },
      });
      if (!sale || sale.tenantId !== tenantId) {
        throw new NotFoundException("Sale not found");
      }
      if (sale.status === "voided") {
        throw new BadRequestException("Cannot return a voided sale");
      }

      // 3. Return Window Check
      const saleAgeMs = Date.now() - sale.createdAt.getTime();
      const maxWindowMs = returnWindowDays * 24 * 60 * 60 * 1000;
      const isOutsideWindow = saleAgeMs > maxWindowMs;

      let overrideByUserId: string | null = null;
      let overrideReason: string | null = null;

      if (isOutsideWindow) {
        const canOverride =
          user?.isOwner ||
          user?.permissions?.includes("sale.return.override") ||
          user?.permissions?.includes("*");
        if (!canOverride) {
          throw new ForbiddenException({
            code: "RETURN_WINDOW_EXCEEDED",
            message: `Sale is outside the ${returnWindowDays}-day return window. Requires sale.return.override permission.`,
          });
        }
        const reason = dto.overrideReason || dto.reason;
        if (!reason || reason.trim().length < 3) {
          throw new UnprocessableEntityException({
            code: "OVERRIDE_REASON_REQUIRED",
            message: "Reason is required when overriding the return window",
          });
        }
        overrideByUserId = userId;
        overrideReason = reason.trim();
      }

      // 4. Load and validate active shift
      const shift = await tx.shift.findUnique({
        where: { id: dto.shiftId },
        include: {
          register: true,
          cashMovements: true,
          sales: { include: { payments: true } },
          returns: true,
        },
      });
      if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
        throw new BadRequestException("Active open shift required for return");
      }

      // 5. Lock sale lines to prevent concurrent over-returns using transaction advisory locks
      const itemIds = dto.items.map((it) => it.saleItemId);
      for (const itemId of itemIds) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${itemId}::text));
        `;
      }

      // 6. Aggregate existing returns per sale item
      const existingReturnItems = await tx.saleReturnItem.findMany({
        where: { saleItemId: { in: itemIds }, tenantId },
      });

      const returnAggMap = new Map<
        string,
        { returnedQtyThousandths: bigint; refundedTotalMinor: bigint; refundedTaxMinor: bigint }
      >();
      for (const eri of existingReturnItems) {
        const prev = returnAggMap.get(eri.saleItemId) || {
          returnedQtyThousandths: 0n,
          refundedTotalMinor: 0n,
          refundedTaxMinor: 0n,
        };
        returnAggMap.set(eri.saleItemId, {
          returnedQtyThousandths: prev.returnedQtyThousandths + parseQuantityThousandths(eri.quantity.toString()),
          refundedTotalMinor: prev.refundedTotalMinor + eri.totalRefundMinor,
          refundedTaxMinor: prev.refundedTaxMinor + eri.taxRefundMinor,
        });
      }

      // 7. Calculate exact refunds and build return items
      let totalRefundMinor = 0n;
      let taxRefundMinor = 0n;
      const returnItemsData: Array<{
        id: string;
        tenantId: string;
        saleItemId: string;
        variantId: string;
        quantity: Prisma.Decimal;
        unitRefundMinor: bigint;
        taxRefundMinor: bigint;
        totalRefundMinor: bigint;
        condition: string;
      }> = [];

      const stockMovementsToApply: Array<{
        branchId: string;
        variantId: string;
        qtyDelta: number;
        type: string;
        refType: string;
        refId: string;
        reason: string;
        actorUserId: string;
      }> = [];

      const returnId = dto.id;

      for (const item of dto.items) {
        const saleItem = sale.items.find((si) => si.id === item.saleItemId);
        if (!saleItem) {
          throw new UnprocessableEntityException({
            code: "SALE_ITEM_NOT_FOUND",
            message: `Sale line ${item.saleItemId} does not belong to sale ${saleId}`,
          });
        }

        const soldQtyThousandths = parseQuantityThousandths(saleItem.quantity.toString());
        const returningQtyThousandths = parseQuantityThousandths(item.quantity);
        const agg = returnAggMap.get(item.saleItemId) || {
          returnedQtyThousandths: 0n,
          refundedTotalMinor: 0n,
          refundedTaxMinor: 0n,
        };

        const totalReturnedAfter = agg.returnedQtyThousandths + returningQtyThousandths;
        if (totalReturnedAfter > soldQtyThousandths) {
          throw new ConflictException({
            code: "OVER_RETURN_PROHIBITED",
            message: `Cannot return ${item.quantity} units of line ${item.saleItemId}. Sold: ${saleItem.quantity}, Already returned: ${Number(agg.returnedQtyThousandths) / 1000}`,
          });
        }

        const refundCalc = calculateLineReturnRefund(
          soldQtyThousandths,
          saleItem.totalMinor,
          saleItem.taxMinor,
          agg.returnedQtyThousandths,
          agg.refundedTotalMinor,
          agg.refundedTaxMinor,
          returningQtyThousandths,
        );

        totalRefundMinor += refundCalc.refundMinor;
        taxRefundMinor += refundCalc.taxRefundMinor;

        const unitRefundMinor = roundHalfUp(
          refundCalc.refundMinor * 1000n,
          returningQtyThousandths,
        );

        returnItemsData.push({
          id: uuidv7(),
          tenantId,
          saleItemId: item.saleItemId,
          variantId: saleItem.variantId,
          quantity: new Prisma.Decimal(item.quantity),
          unitRefundMinor,
          taxRefundMinor: refundCalc.taxRefundMinor,
          totalRefundMinor: refundCalc.refundMinor,
          condition: item.condition,
        });

        // Stock movement configuration
        if (item.condition === "resellable") {
          stockMovementsToApply.push({
            branchId: shift.register.branchId,
            variantId: saleItem.variantId,
            qtyDelta: Number(item.quantity),
            type: "sale_return",
            refType: "sale_return",
            refId: returnId,
            reason: `Sale return ${sale.invoiceNumber}`,
            actorUserId: userId,
          });
        } else {
          // Damaged: stock level increases by 0, ledger records damaged movement
          stockMovementsToApply.push({
            branchId: shift.register.branchId,
            variantId: saleItem.variantId,
            qtyDelta: 0,
            type: "sale_return_damaged",
            refType: "sale_return",
            refId: returnId,
            reason: `Damaged return: ${item.quantity} units from ${sale.invoiceNumber}`,
            actorUserId: userId,
          });
        }

        // Update local accumulator for next items
        returnAggMap.set(item.saleItemId, {
          returnedQtyThousandths: totalReturnedAfter,
          refundedTotalMinor: agg.refundedTotalMinor + refundCalc.refundMinor,
          refundedTaxMinor: agg.refundedTaxMinor + refundCalc.taxRefundMinor,
        });
      }

      // 8. Drawer Cash Check
      if (dto.refundMethod === "cash") {
        const shiftCalc = calculateShiftCashTotals({
          openingCashMinor: shift.openingCashMinor,
          cashMovements: shift.cashMovements,
          sales: shift.sales,
          returns: shift.returns,
        });

        if (totalRefundMinor > shiftCalc.expectedCashMinor) {
          throw new ConflictException({
            code: "DRAWER_CASH_EXCEEDED",
            message: `Cash refund of ${totalRefundMinor} poisha exceeds current drawer cash of ${shiftCalc.expectedCashMinor} poisha`,
          });
        }
      }

      // 9. Generate Return Number
      const returnNumber = await this.generateReturnNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );

      // 10. Record SaleReturn and Items
      const saleReturn = await tx.saleReturn.create({
        data: {
          id: returnId,
          tenantId,
          returnNumber,
          saleId,
          shiftId: dto.shiftId,
          branchId: shift.register.branchId,
          registerId: shift.registerId,
          cashierUserId: userId,
          refundMethod: dto.refundMethod,
          totalRefundMinor,
          taxRefundMinor,
          reason: dto.reason,
          overrideReason,
          overrideByUserId,
          requestPayloadHash: payloadHash,
          items: {
            create: returnItemsData,
          },
        },
        include: {
          items: true,
          sale: { select: { id: true, invoiceNumber: true } },
          cashierUser: { select: { id: true, name: true } },
        },
      });

      // 11. Apply Inventory Movements
      await this.inventoryService.applyMovements(tenantId, tx, stockMovementsToApply);

      // 12. Update Customer Metrics if customer attached
      if (sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            totalSpentMinor: { decrement: totalRefundMinor },
          },
        });
      }

      // 13. Audit Log
      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "sale.return",
          entityType: "sale_return",
          entityId: returnId,
          after: {
            returnNumber,
            saleInvoice: sale.invoiceNumber,
            totalRefundMinor: Number(totalRefundMinor),
            itemsCount: returnItemsData.length,
            refundMethod: dto.refundMethod,
          },
          ip,
        },
        tx,
      );

      return saleReturn;
    });
  }

  async createExchange(
    tenantId: string,
    dto: CreateSaleExchangeDto,
    userId: string,
    ip?: string,
    user?: { isOwner?: boolean; permissions?: string[] },
  ) {
    const payloadHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(dto))
      .digest("hex");

    const { pricesIncludeTax, timeZone, returnWindowDays } =
      await this.getTenantSettings(tenantId);

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // 1. Idempotency Check
      const existing = await tx.saleReturn.findUnique({
        where: { id: dto.id },
        include: { items: true, exchangeSale: { include: { items: true, payments: true } } },
      });
      if (existing) {
        if (existing.tenantId !== tenantId) throw new NotFoundException("Exchange not found");
        if (existing.requestPayloadHash === payloadHash) {
          return { ...existing, isDuplicate: true };
        }
        throw new ConflictException({
          code: "IDEMPOTENCY_CONFLICT",
          message: `Exchange ${dto.id} already exists with different payload`,
        });
      }

      // 2. Validate original sale
      const origSale = await tx.sale.findUnique({
        where: { id: dto.originalSaleId },
        include: { items: true },
      });
      if (!origSale || origSale.tenantId !== tenantId) {
        throw new NotFoundException("Original sale not found");
      }
      if (origSale.status === "voided") {
        throw new BadRequestException("Cannot exchange a voided sale");
      }

      // 3. Validate active shift
      const shift = await tx.shift.findUnique({
        where: { id: dto.shiftId },
        include: {
          register: true,
          cashMovements: true,
          sales: { include: { payments: true } },
          returns: true,
        },
      });
      if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
        throw new BadRequestException("Active open shift required for exchange");
      }

      // 4. Return Window Check
      const saleAgeMs = Date.now() - origSale.createdAt.getTime();
      const maxWindowMs = returnWindowDays * 24 * 60 * 60 * 1000;
      let overrideByUserId: string | null = null;
      let overrideReason: string | null = null;

      if (saleAgeMs > maxWindowMs) {
        const canOverride =
          user?.isOwner ||
          user?.permissions?.includes("sale.return.override") ||
          user?.permissions?.includes("*");
        if (!canOverride) {
          throw new ForbiddenException({
            code: "RETURN_WINDOW_EXCEEDED",
            message: `Sale is outside the ${returnWindowDays}-day return window. Requires sale.return.override permission.`,
          });
        }
        overrideByUserId = userId;
        overrideReason = dto.overrideReason || dto.returnReason || "Exchange outside window";
      }

      // 5. Lock sale lines to prevent concurrent over-returns using transaction advisory locks
      const retItemIds = dto.returnItems.map((it) => it.saleItemId);
      for (const itemId of retItemIds) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${itemId}::text));
        `;
      }

      const existingReturnItems = await tx.saleReturnItem.findMany({
        where: { saleItemId: { in: retItemIds }, tenantId },
      });

      const returnAggMap = new Map<
        string,
        { returnedQtyThousandths: bigint; refundedTotalMinor: bigint; refundedTaxMinor: bigint }
      >();
      for (const eri of existingReturnItems) {
        const prev = returnAggMap.get(eri.saleItemId) || {
          returnedQtyThousandths: 0n,
          refundedTotalMinor: 0n,
          refundedTaxMinor: 0n,
        };
        returnAggMap.set(eri.saleItemId, {
          returnedQtyThousandths: prev.returnedQtyThousandths + parseQuantityThousandths(eri.quantity.toString()),
          refundedTotalMinor: prev.refundedTotalMinor + eri.totalRefundMinor,
          refundedTaxMinor: prev.refundedTaxMinor + eri.taxRefundMinor,
        });
      }

      let returnRefundMinor = 0n;
      let returnTaxRefundMinor = 0n;
      const returnItemsData: any[] = [];
      const stockMovementsToApply: any[] = [];
      const exchangeReturnId = dto.id;
      const exchangeSaleId = uuidv7();

      for (const item of dto.returnItems) {
        const saleItem = origSale.items.find((si) => si.id === item.saleItemId);
        if (!saleItem) {
          throw new UnprocessableEntityException({
            code: "SALE_ITEM_NOT_FOUND",
            message: `Sale line ${item.saleItemId} does not belong to sale ${dto.originalSaleId}`,
          });
        }

        const soldQtyThousandths = parseQuantityThousandths(saleItem.quantity.toString());
        const returningQtyThousandths = parseQuantityThousandths(item.quantity);
        const agg = returnAggMap.get(item.saleItemId) || {
          returnedQtyThousandths: 0n,
          refundedTotalMinor: 0n,
          refundedTaxMinor: 0n,
        };

        if (agg.returnedQtyThousandths + returningQtyThousandths > soldQtyThousandths) {
          throw new ConflictException({
            code: "OVER_RETURN_PROHIBITED",
            message: `Requested exchange return quantity exceeds remaining returnable quantity for line ${item.saleItemId}`,
          });
        }

        const refundCalc = calculateLineReturnRefund(
          soldQtyThousandths,
          saleItem.totalMinor,
          saleItem.taxMinor,
          agg.returnedQtyThousandths,
          agg.refundedTotalMinor,
          agg.refundedTaxMinor,
          returningQtyThousandths,
        );

        returnRefundMinor += refundCalc.refundMinor;
        returnTaxRefundMinor += refundCalc.taxRefundMinor;

        const unitRefundMinor = roundHalfUp(
          refundCalc.refundMinor * 1000n,
          returningQtyThousandths,
        );

        returnItemsData.push({
          id: uuidv7(),
          tenantId,
          saleItemId: item.saleItemId,
          variantId: saleItem.variantId,
          quantity: new Prisma.Decimal(item.quantity),
          unitRefundMinor,
          taxRefundMinor: refundCalc.taxRefundMinor,
          totalRefundMinor: refundCalc.refundMinor,
          condition: item.condition,
        });

        if (item.condition === "resellable") {
          stockMovementsToApply.push({
            branchId: dto.branchId,
            variantId: saleItem.variantId,
            qtyDelta: Number(item.quantity),
            type: "sale_return",
            refType: "sale_return",
            refId: exchangeReturnId,
            reason: `Exchange return ${origSale.invoiceNumber}`,
            actorUserId: userId,
          });
        } else {
          stockMovementsToApply.push({
            branchId: dto.branchId,
            variantId: saleItem.variantId,
            qtyDelta: 0,
            type: "sale_return_damaged",
            refType: "sale_return",
            refId: exchangeReturnId,
            reason: `Damaged exchange return: ${item.quantity} units from ${origSale.invoiceNumber}`,
            actorUserId: userId,
          });
        }
      }

      // 6. Calculate new sale items
      const newVariants = await tx.productVariant.findMany({
        where: { id: { in: dto.newItems.map((i) => i.variantId) }, tenantId },
        include: { product: { include: { taxClass: true } } },
      });
      const newVariantMap = new Map(newVariants.map((v) => [v.id, v]));

      const defaultTax = await tx.taxClass.findFirst({ where: { tenantId, isDefault: true } });
      const defaultTaxRateBp = defaultTax?.rateBp ?? 0;

      const newOriginalPrices: (bigint | null)[] = [];
      const newLineInputs = dto.newItems.map((it) => {
        const v = newVariantMap.get(it.variantId);
        if (!v || !v.isActive || !v.product || !v.product.isActive) {
          throw new UnprocessableEntityException({
            code: "INACTIVE_PRODUCT_OR_VARIANT",
            message: `Variant ${it.variantId} or its product is inactive or not found`,
          });
        }
        let unitPriceMinor = v.priceMinor;
        if (it.overrideUnitPriceMinor !== undefined) {
          const canOverride =
            user?.isOwner ||
            user?.permissions?.includes("sale.price_override") ||
            user?.permissions?.includes("*");
          if (!canOverride) {
            throw new ForbiddenException("Price override requires sale.price_override permission");
          }
          newOriginalPrices.push(v.priceMinor);
          unitPriceMinor = BigInt(it.overrideUnitPriceMinor);
        } else {
          newOriginalPrices.push(null);
        }
        const taxRateBp = v.product.taxClass ? v.product.taxClass.rateBp : defaultTaxRateBp;
        return {
          variantId: it.variantId,
          unitPriceMinor,
          quantity: it.quantity,
          discount: it.discount,
          taxRateBp,
        };
      });

      const newSaleCalc = calculateSaleTotals(newLineInputs, {
        pricesIncludeTax,
        billDiscount: dto.billDiscount,
      });

      // Enforce Cashier Discount Limit on new items
      const mockSaleDto: any = {
        id: exchangeSaleId,
        shiftId: dto.shiftId,
        branchId: dto.branchId,
        items: dto.newItems,
        billDiscount: dto.billDiscount,
        expectedTotalMinor: Number(newSaleCalc.totalMinor),
        payments: dto.payments,
      };
      await enforceDiscountAndOverrideLimits(
        tx,
        userId,
        tenantId,
        mockSaleDto,
        newLineInputs,
        user,
        { grossMinor: newSaleCalc.grossMinor, totalDiscountMinor: newSaleCalc.totalDiscountMinor },
      );

      // 7. Calculate Difference and Payments
      const newTotalMinor = newSaleCalc.totalMinor;
      const differenceMinor = newTotalMinor - returnRefundMinor;

      let paidMinor = 0n;
      let changeMinor = 0n;
      const finalRefundMethod = dto.refundMethod || "cash";

      if (differenceMinor > 0n) {
        // Customer owes money: must be covered by dto.payments
        paidMinor = dto.payments.reduce((s, p) => s + BigInt(p.amountMinor), 0n);
        if (paidMinor < differenceMinor) {
          throw new BadRequestException(
            `Insufficient exchange payment: required ${differenceMinor}, paid ${paidMinor}`,
          );
        }
        changeMinor = paidMinor - differenceMinor;
        const cashPaidMinor = dto.payments
          .filter((p) => p.paymentMethod === "cash")
          .reduce((s, p) => s + BigInt(p.amountMinor), 0n);
        if (changeMinor > cashPaidMinor) {
          throw new UnprocessableEntityException({
            code: "NON_CASH_OVERPAYMENT_PROHIBITED",
            message: "Non-cash payments cannot generate cash change",
          });
        }
      } else if (differenceMinor < 0n) {
        // Shop owes customer refund of the difference
        const refundDifferenceMinor = -differenceMinor;
        if (finalRefundMethod === "cash") {
          const shiftCalc = calculateShiftCashTotals({
            openingCashMinor: shift.openingCashMinor,
            cashMovements: shift.cashMovements,
            sales: shift.sales,
            returns: shift.returns,
          });
          if (refundDifferenceMinor > shiftCalc.expectedCashMinor) {
            throw new ConflictException({
              code: "DRAWER_CASH_EXCEEDED",
              message: `Exchange cash refund of ${refundDifferenceMinor} poisha exceeds current drawer cash of ${shiftCalc.expectedCashMinor} poisha`,
            });
          }
        }
      }

      // 8. Generate numbers
      const returnNumber = await this.generateReturnNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );
      const invoiceNumber = await this.generateInvoiceNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );

      // 9. Stock movements for new items
      const newCostMap = new Map(newVariants.map((v) => [v.id, v.costMinor]));
      for (const line of newSaleCalc.lines) {
        stockMovementsToApply.push({
          branchId: dto.branchId,
          variantId: line.variantId,
          qtyDelta: -Number(line.quantity),
          unitCostMinor: newCostMap.get(line.variantId) ?? 0n,
          type: "sale",
          refType: "sale",
          refId: exchangeSaleId,
          reason: `Exchange sale ${invoiceNumber}`,
          actorUserId: userId,
        });
      }

      // 10. Insert new Sale record first
      const newSale = await tx.sale.create({
        data: {
          id: exchangeSaleId,
          tenantId,
          invoiceNumber,
          shiftId: dto.shiftId,
          branchId: dto.branchId,
          cashierUserId: userId,
          customerId: dto.customerId || origSale.customerId,
          status: "completed",
          subtotalMinor: newSaleCalc.grossMinor,
          discountMinor: newSaleCalc.totalDiscountMinor,
          taxMinor: newSaleCalc.taxMinor,
          totalMinor: newSaleCalc.totalMinor,
          paidMinor: differenceMinor > 0n ? paidMinor : 0n,
          changeMinor,
          notes: dto.notes ? `Exchange against ${origSale.invoiceNumber}: ${dto.notes}` : `Exchange against ${origSale.invoiceNumber}`,
          requestPayloadHash: payloadHash,
          items: {
            create: newSaleCalc.lines.map((l: any, idx: number) => ({
              id: uuidv7(),
              tenantId,
              variantId: l.variantId,
              unitPriceMinor: l.unitPriceMinor,
              originalUnitPriceMinor: newOriginalPrices[idx] ?? null,
              unitCostMinor: newCostMap.get(l.variantId) ?? 0n,
              quantity: new Prisma.Decimal(l.quantity),
              subtotalMinor: l.grossMinor,
              discountMinor: l.lineDiscountMinor + l.allocatedBillDiscountMinor,
              taxRateBp: l.taxRateBp,
              taxMinor: l.taxMinor,
              totalMinor: l.totalMinor,
            })),
          },
          payments: {
            create: dto.payments.map((p) => ({
              id: uuidv7(),
              tenantId,
              paymentMethod: p.paymentMethod,
              amountMinor: BigInt(p.amountMinor),
              reference: p.reference,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      // 11. Insert SaleReturn record referencing exchangeSaleId
      const saleReturn = await tx.saleReturn.create({
        data: {
          id: exchangeReturnId,
          tenantId,
          returnNumber,
          saleId: dto.originalSaleId,
          shiftId: dto.shiftId,
          branchId: dto.branchId,
          registerId: shift.registerId,
          cashierUserId: userId,
          refundMethod: finalRefundMethod,
          totalRefundMinor: returnRefundMinor,
          taxRefundMinor: returnTaxRefundMinor,
          exchangeSaleId: newSale.id,
          reason: dto.returnReason || "Exchange",
          overrideReason,
          overrideByUserId,
          requestPayloadHash: payloadHash,
          items: {
            create: returnItemsData,
          },
        },
        include: {
          items: true,
        },
      });

      // 12. Apply all inventory movements
      await this.inventoryService.applyMovements(tenantId, tx, stockMovementsToApply);

      // 13. Update customer metrics if customer attached
      const customerId = dto.customerId || origSale.customerId;
      if (customerId) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            totalSpentMinor: {
              increment: differenceMinor,
            },
          },
        });
      }

      // 14. Audit Log
      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "sale.exchange",
          entityType: "sale",
          entityId: exchangeSaleId,
          after: {
            returnNumber,
            invoiceNumber,
            originalInvoice: origSale.invoiceNumber,
            returnRefundMinor: Number(returnRefundMinor),
            newSaleTotalMinor: Number(newTotalMinor),
            differenceMinor: Number(differenceMinor),
          },
          ip,
        },
        tx,
      );

      return {
        ...saleReturn,
        return: saleReturn,
        sale: newSale,
        exchangeSale: newSale,
        exchangeSaleId: newSale.id,
        returnNumber,
        invoiceNumber,
        differenceMinor: Number(differenceMinor),
        totalRefundMinor: Number(returnRefundMinor),
        newSaleTotalMinor: Number(newTotalMinor),
      };
    });
  }

  async findMany(tenantId: string, query: ListReturnsQueryDto) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SaleReturnWhereInput = { tenantId };

      if (query.branchId) where.branchId = query.branchId;

      if (query.startDate || query.endDate) {
        where.createdAt = {};
        if (query.startDate) where.createdAt.gte = new Date(query.startDate);
        if (query.endDate) where.createdAt.lte = new Date(query.endDate);
      }

      if (query.search) {
        where.OR = [
          { returnNumber: { contains: query.search, mode: "insensitive" } },
          { sale: { invoiceNumber: { contains: query.search, mode: "insensitive" } } },
        ];
      }

      const allowedSortFields = ["createdAt", "returnNumber", "totalRefundMinor"];
      const sortField = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as any)
        : "createdAt";
      const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const page = query.page || 1;
      const limit = query.limit || 20;
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.saleReturn.count({ where }),
        tx.saleReturn.findMany({
          where,
          include: {
            items: true,
            sale: { select: { id: true, invoiceNumber: true } },
            branch: { select: { id: true, name: true, code: true } },
            cashierUser: { select: { id: true, name: true } },
          },
          orderBy: { [sortField]: sortOrder },
          skip,
          take: limit,
        }),
      ]);

      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const item = await tx.saleReturn.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              variant: {
                select: {
                  id: true,
                  sku: true,
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
          sale: {
            include: {
              customer: true,
            },
          },
          branch: true,
          register: true,
          cashierUser: { select: { id: true, name: true, email: true } },
          exchangeSale: true,
        },
      });

      if (!item || item.tenantId !== tenantId) {
        throw new NotFoundException("Return not found");
      }

      return item;
    });
  }
}
