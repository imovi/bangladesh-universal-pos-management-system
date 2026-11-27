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
  CreateSaleExchangeDto,
  calculateLineReturnRefund,
  parseQuantityThousandths,
  calculateShiftCashTotals,
  calculateSaleTotals,
  roundHalfUp,
  computeBaseQuantity,
} from "@universal-pos/shared";
import { enforceDiscountAndOverrideLimits } from "./sales-discount.helper.js";
import {
  lockSaleItems,
  generateReturnNumber,
  generateInvoiceNumber,
} from "./returns-common.helper.js";

@Injectable()
export class ExchangesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly systemDb: SystemDbService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
  ) {}

  private async getTenantSettings(tenantId: string) {
    const tenant = await this.systemDb.findTenantById(tenantId);
    const settings = (tenant?.settings as any) || {};
    return {
      pricesIncludeTax: settings.pricesIncludeTax ?? true,
      timeZone: settings.timeZone ?? "Asia/Dhaka",
      returnWindowDays: settings.returnWindowDays ?? 7,
    };
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
          return {
            ...existing,
            return: existing,
            sale: existing.exchangeSale,
            exchangeSale: existing.exchangeSale,
            exchangeSaleId: existing.exchangeSale?.id,
            isDuplicate: true,
          };
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
          customerPayments: true,
        },
      });
      if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
        throw new BadRequestException("Active open shift required for exchange");
      }

      // 4. Return Window Check
      const saleAgeMs = Date.now() - origSale.createdAt.getTime();
      const maxWindowMs = returnWindowDays * 24 * 60 * 60 * 1000;
      let overrideByUserId: string | null = null;
      let overrideReason: string | undefined = undefined;

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
        if (!dto.overrideReason || !dto.overrideReason.trim()) {
          throw new UnprocessableEntityException({
            code: "OVERRIDE_REASON_REQUIRED",
            message: "overrideReason is required when overriding return window",
          });
        }
        overrideByUserId = userId;
        overrideReason = dto.overrideReason;
      }

      // 5. Lock sale lines to prevent concurrent over-returns using transaction advisory locks
      const retItemIds = dto.returnItems.map((it) => it.saleItemId);
      await lockSaleItems(tx, retItemIds);

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

        const origFactor = saleItem.unitFactor ? Number(saleItem.unitFactor) : 1;
        const returnBaseQty = computeBaseQuantity(item.quantity, origFactor);

        returnItemsData.push({
          id: uuidv7(),
          tenantId,
          saleItemId: item.saleItemId,
          variantId: saleItem.variantId,
          quantity: new Prisma.Decimal(item.quantity),
          baseQuantity: new Prisma.Decimal(returnBaseQty),
          unitRefundMinor,
          taxRefundMinor: refundCalc.taxRefundMinor,
          totalRefundMinor: refundCalc.refundMinor,
          condition: item.condition,
        });

        if (item.condition === "resellable") {
          stockMovementsToApply.push({
            branchId: dto.branchId,
            variantId: saleItem.variantId,
            qtyDelta: returnBaseQty,
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
        include: { product: { include: { taxClass: true } }, unitPrices: true },
      });
      const newVariantMap = new Map(newVariants.map((v) => [v.id, v]));

      const newUnitIds = dto.newItems.map((i: any) => i.productUnitId).filter(Boolean) as string[];
      const newUnits = newUnitIds.length > 0
        ? await tx.productUnit.findMany({ where: { id: { in: newUnitIds }, tenantId } })
        : [];
      const newUnitMap = new Map(newUnits.map((u) => [u.id, u]));

      const defaultTax = await tx.taxClass.findFirst({ where: { tenantId, isDefault: true } });
      const defaultTaxRateBp = defaultTax?.rateBp ?? 0;

      const newOriginalPrices: (bigint | null)[] = [];
      const lineUnitSnapshots: { productUnitId: string | null; unitName: string; unitFactor: number; baseQuantity: number }[] = [];
      const newLineInputs = dto.newItems.map((it: any) => {
        const v = newVariantMap.get(it.variantId);
        if (!v || !v.isActive || !v.product || !v.product.isActive) {
          throw new UnprocessableEntityException({
            code: "INACTIVE_PRODUCT_OR_VARIANT",
            message: `Variant ${it.variantId} or its product is inactive or not found`,
          });
        }
        let unitPriceMinor = v.priceMinor;
        let unitName = "pcs";
        let unitFactor = 1;
        if (it.productUnitId) {
          const unit = newUnitMap.get(it.productUnitId);
          if (unit) {
            unitName = unit.name;
            unitFactor = Number(unit.factor);
            const overridePrice = v.unitPrices.find((up) => up.productUnitId === unit.id);
            if (overridePrice) {
              unitPriceMinor = overridePrice.priceMinor;
            } else {
              unitPriceMinor = BigInt(Math.round(Number(v.priceMinor) * unitFactor));
            }
          }
        }
        const baseQuantity = computeBaseQuantity(it.quantity, unitFactor);
        lineUnitSnapshots.push({
          productUnitId: it.productUnitId || null,
          unitName,
          unitFactor,
          baseQuantity,
        });

        if (it.overrideUnitPriceMinor !== undefined) {
          const canOverride =
            user?.isOwner ||
            user?.permissions?.includes("sale.price_override") ||
            user?.permissions?.includes("*");
          if (!canOverride) {
            throw new ForbiddenException("Price override requires sale.price_override permission");
          }
          newOriginalPrices.push(unitPriceMinor);
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
            customerPayments: shift.customerPayments,
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
      const returnNumber = await generateReturnNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );
      const invoiceNumber = await generateInvoiceNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );

      // 9. Cost mapping for movements
      const newCostMap = new Map(newVariants.map((v) => [v.id, v.costMinor]));
      for (let i = 0; i < newSaleCalc.lines.length; i++) {
        const line = newSaleCalc.lines[i];
        const snapshot = lineUnitSnapshots[i];
        stockMovementsToApply.push({
          branchId: dto.branchId,
          variantId: line.variantId,
          qtyDelta: -Number(snapshot?.baseQuantity ?? line.quantity),
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
            create: newSaleCalc.lines.map((l: any, idx: number) => {
              const snapshot = lineUnitSnapshots[idx];
              return {
                id: uuidv7(),
                tenantId,
                variantId: l.variantId,
                productUnitId: snapshot?.productUnitId ?? null,
                unitName: snapshot?.unitName ?? "pcs",
                unitFactor: new Prisma.Decimal(snapshot?.unitFactor ?? 1),
                baseQuantity: new Prisma.Decimal(snapshot?.baseQuantity ?? l.quantity),
                unitPriceMinor: l.unitPriceMinor,
                originalUnitPriceMinor: newOriginalPrices[idx] ?? null,
                unitCostMinor: newCostMap.get(l.variantId) ?? 0n,
                quantity: new Prisma.Decimal(l.quantity),
                subtotalMinor: l.grossMinor,
                discountMinor: l.lineDiscountMinor + l.allocatedBillDiscountMinor,
                taxRateBp: l.taxRateBp,
                taxMinor: l.taxMinor,
                totalMinor: l.totalMinor,
              };
            }),
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
      // Tag reason with [exchange_applied:X] so shift cash calculations accurately reflect actual drawer cash
      const exchangeApplied = differenceMinor >= 0n ? returnRefundMinor : newTotalMinor;
      const returnReasonWithMeta = `${dto.returnReason || "Exchange"} [exchange_applied:${exchangeApplied}]`;

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
          reason: returnReasonWithMeta,
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
}
