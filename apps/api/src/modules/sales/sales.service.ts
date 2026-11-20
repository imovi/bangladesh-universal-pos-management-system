import {
  Injectable, NotFoundException, BadRequestException, ConflictException,
  ForbiddenException, UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { AuditService } from "../audit/audit.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  CreateSaleDto,
  VoidSaleDto,
  calculateSaleTotals,
  formatDateKey,
  evaluatePromotions,
  distributeProportional,
  parseQuantityThousandths,
  formatQuantityFromThousandths,
  roundHalfUp,
  PromotionRule,
  PromotionEvaluationLineItem,
} from "@universal-pos/shared";
import { validateDiscountsNonNegative, enforceDiscountAndOverrideLimits } from "./sales-discount.helper.js";
import { computeSalePayloadHash, matchesSalePayload } from "./sales-hash.helper.js";
import { CustomersService } from "../shifts/customers.service.js";

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly systemDb: SystemDbService,
    private readonly customersService: CustomersService,
  ) {}

  private async generateInvoiceNumber(
    tenantId: string, registerId: string, tx: Prisma.TransactionClient, timeZone = "Asia/Dhaka",
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

  private async updateCustomerMetrics(
    tx: Prisma.TransactionClient,
    customerId: string | undefined,
    amountMinor: bigint,
    isVoid = false,
  ): Promise<void> {
    if (!customerId) return;
    await tx.customer.update({
      where: { id: customerId },
      data: isVoid
        ? { totalSpentMinor: { decrement: amountMinor }, totalVisits: { decrement: 1 } }
        : { totalSpentMinor: { increment: amountMinor }, totalVisits: { increment: 1 } },
    });
  }

  private resolveItemPricingAndTaxes(
    items: CreateSaleDto["items"],
    variantMap: Map<string, any>,
    defaultTaxRateBp: number,
    user?: { isOwner?: boolean; permissions?: string[] },
    isOffline = false,
    catalogVersion?: string,
  ) {
    const canOverride = Boolean(
      user?.isOwner ||
        user?.permissions?.includes("sale.price_override") ||
        user?.permissions?.includes("*"),
    );

    const originalPrices: (bigint | null)[] = [];
    const priceFlags: Array<{ flag: string; details?: any }> = [];

    const lineInputs = items.map((it) => {
      const v = variantMap.get(it.variantId);
      if (!v || !v.isActive || !v.product || !v.product.isActive) {
        if (!isOffline) {
          throw new UnprocessableEntityException({
            code: "INACTIVE_PRODUCT_OR_VARIANT",
            message: `Variant ${it.variantId} or its product is inactive or not found`,
          });
        }
      }

      const catalogPrice = v ? v.priceMinor : 0n;
      let unitPriceMinor = catalogPrice;
      let priceDiffered = false;

      if (it.unitPriceMinor !== undefined) {
        if (BigInt(it.unitPriceMinor) !== catalogPrice) {
          priceDiffered = true;
          unitPriceMinor = BigInt(it.unitPriceMinor);
        }
        originalPrices.push(catalogPrice);
      } else if (it.overrideUnitPriceMinor !== undefined) {
        if (!canOverride && !isOffline) {
          throw new ForbiddenException("Price override requires sale.price_override permission");
        }
        originalPrices.push(catalogPrice);
        unitPriceMinor = BigInt(it.overrideUnitPriceMinor);
        priceDiffered = true;
      } else {
        originalPrices.push(null);
      }

      if (priceDiffered && isOffline) {
        if (catalogVersion) {
          priceFlags.push({
            flag: "PRICE_CHANGED",
            details: {
              variantId: it.variantId,
              catalogPriceMinor: Number(catalogPrice),
              soldPriceMinor: Number(unitPriceMinor),
              catalogVersion,
            },
          });
        } else {
          priceFlags.push({
            flag: "PRICE_UNKNOWN",
            details: {
              variantId: it.variantId,
              catalogPriceMinor: Number(catalogPrice),
              soldPriceMinor: Number(unitPriceMinor),
            },
          });
        }
      }

      const taxRateBp = v?.product?.taxClass ? v.product.taxClass.rateBp : defaultTaxRateBp;
      return { variantId: it.variantId, unitPriceMinor, quantity: it.quantity, discount: it.discount, taxRateBp };
    });

    return { lineInputs, originalPrices, priceFlags };
  }

  private computeAndValidateTotals(
    dto: CreateSaleDto,
    lineInputs: any[],
    pricesIncludeTax: boolean,
  ) {
    validateDiscountsNonNegative(dto, lineInputs);
    const calculated = calculateSaleTotals(lineInputs, { pricesIncludeTax, billDiscount: dto.billDiscount });

    if (BigInt(dto.expectedTotalMinor) !== calculated.totalMinor) {
      throw new UnprocessableEntityException({
        code: dto.isOffline ? "TOTALS_MISMATCH" : "CALCULATION_MISMATCH",
        message: "Totals mismatch: client total differs from server recomputation",
        details: [{
          field: "expectedTotalMinor",
          issue: `Expected total ${dto.expectedTotalMinor} does not match computed total ${calculated.totalMinor}`,
          serverTotalMinor: Number(calculated.totalMinor), clientTotalMinor: dto.expectedTotalMinor,
          breakdown: {
            grossMinor: Number(calculated.grossMinor), discountMinor: Number(calculated.totalDiscountMinor),
            taxMinor: Number(calculated.taxMinor), totalMinor: Number(calculated.totalMinor),
            lines: calculated.lines.map((l) => ({
              variantId: l.variantId, unitPriceMinor: Number(l.unitPriceMinor), quantity: l.quantity,
              grossMinor: Number(l.grossMinor), discountMinor: Number(l.lineDiscountMinor + l.allocatedBillDiscountMinor),
              taxMinor: Number(l.taxMinor), totalMinor: Number(l.totalMinor),
            })),
          },
        }],
      });
    }

    const paidMinor = dto.payments.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
    let changeMinor = 0n;
    let dueMinor = 0n;

    if (paidMinor > calculated.totalMinor) {
      changeMinor = paidMinor - calculated.totalMinor;
      const cashPaidMinor = dto.payments.filter((p) => p.paymentMethod === "cash").reduce((s, p) => s + BigInt(p.amountMinor), 0n);
      if (changeMinor > cashPaidMinor) {
        throw new UnprocessableEntityException({
          code: "NON_CASH_OVERPAYMENT_PROHIBITED",
          message: "Non-cash payments cannot generate cash change",
        });
      }
    } else if (paidMinor < calculated.totalMinor) {
      dueMinor = calculated.totalMinor - paidMinor;
    }

    return { calculated, paidMinor, changeMinor, dueMinor };
  }

  private async linkOfflineMismatch(
    tx: Prisma.TransactionClient,
    tenantId: string,
    existing: any,
    offlineInvoiceNumber: string,
  ) {
    if (!existing.offlineInvoiceNumber) {
      await tx.sale.update({
        where: { id: existing.id },
        data: { offlineInvoiceNumber },
      });
    }
    const existingFlag = await tx.saleReviewFlag.findFirst({
      where: { saleId: existing.id, flag: "NUMBER_MISMATCH" },
    });
    if (!existingFlag) {
      await tx.saleReviewFlag.create({
        data: {
          id: uuidv7(),
          tenantId,
          saleId: existing.id,
          flag: "NUMBER_MISMATCH",
          details: {
            serverInvoiceNumber: existing.invoiceNumber,
            offlineInvoiceNumber,
          },
          status: "open",
        },
      });
    }
    return { ...existing, offlineInvoiceNumber, isDuplicate: true };
  }

  private async checkIdempotency(
    tx: Prisma.TransactionClient, id: string, tenantId: string, dto: CreateSaleDto, payloadHash: string,
  ) {
    const existing = await tx.sale.findUnique({ where: { id }, include: { items: true, payments: true } });
    if (!existing || existing.tenantId !== tenantId) return null;

    // Handle lost response retry where original sale was saved online, but client converted to offline
    if (dto.isOffline && dto.invoiceNumber && existing.invoiceNumber !== dto.invoiceNumber) {
      return this.linkOfflineMismatch(tx, tenantId, existing, dto.invoiceNumber);
    }

    if (matchesSalePayload(existing, payloadHash, dto)) return { ...existing, isDuplicate: true };
    throw new ConflictException({
      code: "IDEMPOTENCY_CONFLICT", message: `Sale ${dto.id} already exists with different payload`,
    });
  }

  private buildSaleItemsData(
    tenantId: string, lines: any[], costMap: Map<string, bigint>, originalPrices: (bigint | null)[],
  ) {
    return lines.map((l: any, idx: number) => ({
      id: uuidv7(), tenantId, variantId: l.variantId, unitPriceMinor: l.unitPriceMinor,
      originalUnitPriceMinor: originalPrices[idx] ?? null, unitCostMinor: costMap.get(l.variantId) ?? 0n,
      quantity: new Prisma.Decimal(l.quantity), subtotalMinor: l.grossMinor,
      discountMinor: l.lineDiscountMinor !== undefined && l.allocatedBillDiscountMinor !== undefined
        ? l.lineDiscountMinor + l.allocatedBillDiscountMinor
        : l.discountMinor ?? 0n,
      taxRateBp: l.taxRateBp, taxMinor: l.taxMinor, totalMinor: l.totalMinor,
      promotionId: l.promotionId ?? null,
      promotionDiscountMinor: l.promotionDiscountMinor ? BigInt(l.promotionDiscountMinor) : 0n,
      promotionLabel: l.promotionLabel ?? null,
    }));
  }

  private async executeSaleInsert(
    tx: Prisma.TransactionClient, tenantId: string, dto: CreateSaleDto,
    meta: {
      saleId: string; inv: string; calc: any; paid: bigint; change: bigint; due: bigint;
      userId: string; costMap: Map<string, bigint>; originalPrices: (bigint | null)[]; payloadHash: string;
      occurredAt: Date; syncedAt: Date | null; isOffline: boolean; catalogVersion: string | null;
      billPromotionId?: string | null; billPromotionDiscountMinor?: bigint; couponCode?: string | null;
    },
  ) {
    return tx.sale.create({
      data: {
        id: meta.saleId, tenantId, invoiceNumber: meta.inv, shiftId: dto.shiftId,
        branchId: dto.branchId, cashierUserId: meta.userId, customerId: dto.customerId,
        status: "completed", subtotalMinor: meta.calc.grossMinor, discountMinor: meta.calc.totalDiscountMinor,
        taxMinor: meta.calc.taxMinor, totalMinor: meta.calc.totalMinor, paidMinor: meta.paid,
        changeMinor: meta.change, dueMinor: meta.due, notes: dto.notes, requestPayloadHash: meta.payloadHash,
        occurredAt: meta.occurredAt, syncedAt: meta.syncedAt, isOffline: meta.isOffline, catalogVersion: meta.catalogVersion,
        billPromotionId: meta.billPromotionId ?? null,
        billPromotionDiscountMinor: meta.billPromotionDiscountMinor ?? 0n,
        couponCode: meta.couponCode ?? null,
        items: { create: this.buildSaleItemsData(tenantId, meta.calc.lines, meta.costMap, meta.originalPrices) },
        payments: {
          create: dto.payments.map((p) => ({ id: uuidv7(), tenantId, paymentMethod: p.paymentMethod, amountMinor: BigInt(p.amountMinor), reference: p.reference })),
        },
      },
      include: { items: true, payments: true },
    });
  }

  private async loadShiftAndVariants(tx: Prisma.TransactionClient, tenantId: string, dto: CreateSaleDto) {
    const shift = await tx.shift.findUnique({ where: { id: dto.shiftId }, include: { register: true } });
    if (!shift || shift.tenantId !== tenantId) {
      throw new NotFoundException("Shift not found");
    }

    let isShiftClosed = false;
    if (shift.status !== "open") {
      if (dto.isOffline && shift.status === "closed") {
        isShiftClosed = true;
      } else {
        throw new BadRequestException("Active open shift required for sale");
      }
    }

    if (dto.isOffline && !shift.register.allowOffline) {
      throw new BadRequestException("Offline selling is not allowed on this register");
    }

    if (shift.register.branchId !== dto.branchId) {
      throw new UnprocessableEntityException({
        code: "BRANCH_SHIFT_MISMATCH",
        message: "Shift register branch does not match sale branch",
      });
    }
    const defaultTax = await tx.taxClass.findFirst({ where: { tenantId, isDefault: true } });
    const variants = await tx.productVariant.findMany({
      where: { id: { in: dto.items.map((i) => i.variantId) }, tenantId },
      include: { product: { include: { taxClass: true } } },
    });
    return { shift, defaultTaxRateBp: defaultTax?.rateBp ?? 0, variants, isShiftClosed };
  }

  private async finalizeSaleOperations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    meta: {
      saleId: string; inv: string; calc: any; branchId: string; customerId?: string;
      userId: string; ip?: string; costMap: Map<string, bigint>; isOffline?: boolean;
    },
  ) {
    const { negativeStockItems } = await this.inventoryService.applyMovements(
      tenantId, tx,
      meta.calc.lines.map((l: any) => ({
        branchId: meta.branchId, variantId: l.variantId, qtyDelta: -Number(l.quantity),
        unitCostMinor: meta.costMap.get(l.variantId) ?? 0n,
        type: "sale", refType: "sale", refId: meta.saleId, reason: `Sale ${meta.inv}`, actorUserId: meta.userId,
      })),
      { allowNegativeOverride: Boolean(meta.isOffline) },
    );
    await this.updateCustomerMetrics(tx, meta.customerId, meta.calc.totalMinor, false);
    await this.auditService.log(
      {
        tenantId, actorUserId: meta.userId, action: "sale.create", entityType: "sale", entityId: meta.saleId,
        after: { invoiceNumber: meta.inv, totalMinor: Number(meta.calc.totalMinor), itemsCount: meta.calc.lines.length }, ip: meta.ip,
      },
      tx,
    );
    return { negativeStockItems };
  }

  private async getTenantSettings(tenantId: string) {
    const tenant = await this.systemDb.findTenantById(tenantId);
    const settings = (tenant?.settings as Record<string, unknown>) || {};
    return {
      pricesIncludeTax: (settings.prices_include_tax as boolean) ?? true,
      timeZone: (settings.timezone as string) || "Asia/Dhaka",
    };
  }

  private async handleOverrideAudit(
    tx: Prisma.TransactionClient, tenantId: string, userId: string,
    saleId: string, inv: string, ov: { priceOverrideUsed: boolean; discountOverrideUsed: boolean }, ip?: string,
  ) {
    if (!ov.priceOverrideUsed && !ov.discountOverrideUsed) return;
    await this.auditService.log({
      tenantId, actorUserId: userId, action: "sale.override", entityType: "sale", entityId: saleId,
      after: { invoiceNumber: inv, ...ov }, ip,
    }, tx);
  }

  private async handleSaleCreationConflict(tenantId: string, dto: CreateSaleDto, payloadHash: string): Promise<any> {
    const existing = await this.findById(tenantId, dto.id).catch(() => null);
    if (existing) {
      if (dto.isOffline && dto.invoiceNumber && existing.invoiceNumber !== dto.invoiceNumber) {
        return this.tenantContext.runWithTenant(tenantId, async (tx) => {
          return this.linkOfflineMismatch(tx, tenantId, existing, dto.invoiceNumber!);
        });
      }
      if (matchesSalePayload(existing, payloadHash, dto)) return { ...existing, isDuplicate: true };
      throw new ConflictException({
        code: "IDEMPOTENCY_CONFLICT", message: `Sale ${dto.id} already exists with different payload`,
      });
    }
    throw new ConflictException({
      code: "CONCURRENT_REQUEST", message: "A concurrent request with the same identifier is in progress",
    });
  }

  async create(
    tenantId: string, dto: CreateSaleDto, userId: string, ip?: string,
    user?: { isOwner?: boolean; permissions?: string[] },
  ) {
    const payloadHash = computeSalePayloadHash(dto);
    const { pricesIncludeTax, timeZone } = await this.getTenantSettings(tenantId);
    try {
      return await this.tenantContext.runWithTenant(tenantId, async (tx) => {
        const duplicate = await this.checkIdempotency(tx, dto.id, tenantId, dto, payloadHash);
        if (duplicate) return duplicate;

        const { shift, defaultTaxRateBp, variants, isShiftClosed } = await this.loadShiftAndVariants(tx, tenantId, dto);
        const variantMap = new Map(variants.map((v) => [v.id, v]));
        const { lineInputs, originalPrices, priceFlags } = this.resolveItemPricingAndTaxes(
          dto.items,
          variantMap,
          defaultTaxRateBp,
          user,
          dto.isOffline,
          dto.catalogVersion ?? undefined,
        );
        let calculated: any;
        let paidMinor: bigint;
        let changeMinor: bigint;
        let dueMinor: bigint;
        let billPromotionId: string | null = null;
        let billPromotionDiscountMinor: bigint = 0n;
        let appliedPromoSummary: any[] = [];

        // Basic sanity checks on discounts
        for (const item of dto.items) {
          if (item.promotionDiscountMinor !== undefined && item.promotionDiscountMinor !== null && item.promotionDiscountMinor < 0) {
            throw new BadRequestException("Line promotion discount cannot be negative");
          }
          if (item.discount?.amountMinor !== undefined && item.discount.amountMinor !== null && item.discount.amountMinor < 0) {
            throw new BadRequestException("Line discount cannot be negative");
          }
        }
        if (dto.billPromotionDiscountMinor !== undefined && dto.billPromotionDiscountMinor !== null && dto.billPromotionDiscountMinor < 0) {
          throw new BadRequestException("Bill promotion discount cannot be negative");
        }
        if (dto.billDiscount?.amountMinor !== undefined && dto.billDiscount.amountMinor !== null && dto.billDiscount.amountMinor < 0) {
          throw new BadRequestException("Bill discount cannot be negative");
        }

        // Check no line's discount is greater than line gross
        for (let idx = 0; idx < dto.items.length; idx++) {
          const item = dto.items[idx];
          const lineInput = lineInputs[idx];
          const unitPrice = BigInt(lineInput.unitPriceMinor);
          const qtyThousandths = parseQuantityThousandths(lineInput.quantity);
          const grossMinor = roundHalfUp(unitPrice * qtyThousandths, 1000n);

          if (item.promotionDiscountMinor !== undefined && item.promotionDiscountMinor !== null) {
            if (BigInt(item.promotionDiscountMinor) > grossMinor) {
              throw new BadRequestException("Line promotion discount exceeds line gross amount");
            }
          }
        }

        // Check all client promotion IDs belong to this tenant
        const clientPromoIds = [
          dto.billPromotionId,
          ...dto.items.map((i) => i.promotionId),
        ].filter(Boolean) as string[];

        const uniqueClientPromoIds = [...new Set(clientPromoIds)];
        if (uniqueClientPromoIds.length > 0) {
          const matchingPromos = await tx.promotion.findMany({
            where: {
              tenantId,
              id: { in: uniqueClientPromoIds },
            },
            select: { id: true, name: true },
          });
          if (matchingPromos.length !== uniqueClientPromoIds.length) {
            throw new BadRequestException("One or more promotion IDs do not belong to this tenant");
          }
        }

        const hasClientPromotions =
          uniqueClientPromoIds.length > 0 ||
          (dto.billPromotionDiscountMinor !== undefined && dto.billPromotionDiscountMinor !== null && dto.billPromotionDiscountMinor > 0) ||
          dto.items.some((i) => i.promotionDiscountMinor !== undefined && i.promotionDiscountMinor !== null && i.promotionDiscountMinor > 0);

        // Check if tenant has active promotions or couponCode provided
        const activePromos = await tx.promotion.findMany({
          where: { tenantId, status: "active" },
          include: { coupons: true },
          orderBy: { priority: "desc" },
        });

        let lockedCoupon: any = null;
        if (dto.couponCode) {
          const normalizedCode = dto.couponCode.trim().toUpperCase();
          const rows = await tx.$queryRaw<Array<{
            id: string;
            tenant_id: string;
            promotion_id: string | null;
            code: string;
            usage_limit_total: number | null;
            usage_limit_per_customer: number | null;
            times_used: number;
            is_active: boolean;
            expires_at: Date | null;
          }>>`
            SELECT id, tenant_id, promotion_id, code, usage_limit_total, usage_limit_per_customer, times_used, is_active, expires_at
            FROM coupons
            WHERE tenant_id = ${tenantId}::uuid AND UPPER(code) = ${normalizedCode}
            FOR UPDATE;
          `;
          lockedCoupon = rows[0] || null;

          if (!lockedCoupon) {
            if (!dto.isOffline) {
              throw new UnprocessableEntityException({
                code: "COUPON_INVALID",
                message: "Coupon code is invalid",
              });
            } else {
              priceFlags.push({
                flag: "COUPON_LIMIT_EXCEEDED",
                details: { couponCode: normalizedCode, reason: "INVALID_CODE" },
              });
            }
          } else {
            if (!lockedCoupon.is_active) {
              if (!dto.isOffline) {
                throw new UnprocessableEntityException({
                  code: "COUPON_INACTIVE",
                  message: "Coupon is not active",
                });
              } else {
                priceFlags.push({
                  flag: "COUPON_LIMIT_EXCEEDED",
                  details: { couponCode: normalizedCode, reason: "INACTIVE" },
                });
              }
            }

            if (
              lockedCoupon.expires_at &&
              new Date(lockedCoupon.expires_at) < (dto.isOffline && dto.occurredAt ? new Date(dto.occurredAt) : new Date())
            ) {
              if (!dto.isOffline) {
                throw new UnprocessableEntityException({
                  code: "COUPON_EXPIRED",
                  message: "Coupon has expired",
                });
              } else {
                priceFlags.push({
                  flag: "COUPON_LIMIT_EXCEEDED",
                  details: { couponCode: normalizedCode, reason: "EXPIRED" },
                });
              }
            }

            if (lockedCoupon.usage_limit_total !== null && lockedCoupon.times_used >= lockedCoupon.usage_limit_total) {
              if (!dto.isOffline) {
                throw new UnprocessableEntityException({
                  code: "COUPON_LIMIT_REACHED",
                  message: "Coupon usage limit reached",
                });
              } else {
                priceFlags.push({
                  flag: "COUPON_LIMIT_EXCEEDED",
                  details: {
                    couponCode: normalizedCode,
                    reason: "USAGE_LIMIT_REACHED",
                    timesUsed: lockedCoupon.times_used,
                    usageLimitTotal: lockedCoupon.usage_limit_total,
                  },
                });
              }
            }

            if (lockedCoupon.usage_limit_per_customer !== null && dto.customerId) {
              const custUses = await tx.couponUsage.count({
                where: { couponId: lockedCoupon.id, customerId: dto.customerId },
              });
              if (custUses >= lockedCoupon.usage_limit_per_customer) {
                if (!dto.isOffline) {
                  throw new UnprocessableEntityException({
                    code: "COUPON_LIMIT_REACHED",
                    message: "Coupon per-customer usage limit reached",
                  });
                } else {
                  priceFlags.push({
                    flag: "COUPON_LIMIT_EXCEEDED",
                    details: {
                      couponCode: normalizedCode,
                      reason: "CUSTOMER_LIMIT_REACHED",
                      timesUsed: custUses,
                      usageLimitPerCustomer: lockedCoupon.usage_limit_per_customer,
                    },
                  });
                }
              }
            }
          }
        }

        const shouldEvaluatePromotions = activePromos.length > 0 || Boolean(dto.couponCode) || (dto.isOffline && hasClientPromotions);

        if (shouldEvaluatePromotions) {
          let promoEval: any = null;
          let serverComputedTotalMinor: bigint;
          let serverPromotionDiscountMinor: bigint = 0n;

          if (activePromos.length > 0 || dto.couponCode) {
            const promoRules: PromotionRule[] = activePromos.map((p) => {
              const promoCoupons = (p as any).coupons || [];
              const couponCodes = promoCoupons.map((c: any) => c.code.toUpperCase());
              const isCouponRequired = Boolean((p.conditions as any)?.couponRequired || promoCoupons.length > 0);
              return {
                id: p.id,
                name: p.name,
                description: p.description || undefined,
                type: p.type as any,
                status: p.status as any,
                priority: p.priority,
                stackableWithBill: p.stackableWithBill,
                membersOnly: Boolean((p.conditions as any)?.membersOnly),
                branchIds: (p.conditions as any)?.branchIds,
                minQuantity: (p.conditions as any)?.minQuantity,
                startAt: p.startDate ? p.startDate : new Date("2020-01-01"),
                endAt: p.endDate ? p.endDate : new Date("2030-01-01"),
                daysOfWeek: (p.conditions as any)?.daysOfWeek,
                hours: (p.conditions as any)?.hours,
                targetType: ((p.targets as any)?.targetType || "ALL") as any,
                targetIds: (p.targets as any)?.targetIds,
                exclusionIds: (p.targets as any)?.exclusionIds,
                couponRequired: isCouponRequired,
                couponCodes: couponCodes.length > 0 ? couponCodes : undefined,
                config: (p.config || {}) as any,
                createdAt: p.createdAt,
              };
            });

            const promoOccurredAt = dto.isOffline && dto.occurredAt ? new Date(dto.occurredAt) : new Date();
            const promoLineInputs: PromotionEvaluationLineItem[] = lineInputs.map((l: any, idx: number) => {
              const v = variantMap.get(l.variantId);
              const origItem = dto.items[idx];
              return {
                lineId: l.lineId,
                variantId: l.variantId,
                productId: v?.productId || "",
                categoryId: v?.product?.categoryId || undefined,
                unitPriceMinor: l.unitPriceMinor,
                quantity: l.quantity,
                taxRateBp: l.taxRateBp,
                manualDiscount: origItem?.discount ? {
                  type: origItem.discount.type,
                  amountMinor: origItem.discount.amountMinor,
                  percentBp: origItem.discount.percentBp,
                } : undefined,
              };
            });

            promoEval = evaluatePromotions({
              lines: promoLineInputs,
              promotions: promoRules,
              couponCode: dto.couponCode || undefined,
              customerId: dto.customerId || undefined,
              branchId: dto.branchId,
              evaluationTime: promoOccurredAt,
              manualBillDiscount: dto.billDiscount ? {
                type: dto.billDiscount.type,
                amountMinor: dto.billDiscount.amountMinor ? BigInt(dto.billDiscount.amountMinor) : undefined,
                percentBp: dto.billDiscount.percentBp,
              } : undefined,
            });

            serverComputedTotalMinor = promoEval.totalMinor;
            serverPromotionDiscountMinor = promoEval.totalPromotionDiscountMinor;
          } else {
            const standardCalc = calculateSaleTotals(lineInputs, { pricesIncludeTax, billDiscount: dto.billDiscount });
            serverComputedTotalMinor = standardCalc.totalMinor;
            serverPromotionDiscountMinor = 0n;
          }

          if (BigInt(dto.expectedTotalMinor) === serverComputedTotalMinor) {
            if (promoEval) {
              appliedPromoSummary = promoEval.appliedPromotions;
              billPromotionId = promoEval.billPromotionId || null;
              billPromotionDiscountMinor = promoEval.billPromotionDiscountMinor;

              calculated = {
                grossMinor: promoEval.grossMinor,
                totalDiscountMinor: promoEval.totalDiscountMinor,
                lineDiscountMinor: promoEval.linePromotionDiscountMinor,
                billDiscountMinor: promoEval.billPromotionDiscountMinor,
                taxMinor: promoEval.taxMinor,
                netMinor: promoEval.netMinor,
                totalMinor: promoEval.totalMinor,
                lines: promoEval.lines.map((l: any) => ({
                  variantId: l.variantId,
                  quantity: l.quantity,
                  unitPriceMinor: l.unitPriceMinor,
                  grossMinor: l.grossMinor,
                  lineDiscountMinor: l.promotionDiscountMinor,
                  allocatedBillDiscountMinor: l.allocatedBillPromotionMinor,
                  effectiveLineNetMinor: l.effectiveLineNetMinor,
                  taxRateBp: l.taxRateBp,
                  taxMinor: l.taxMinor,
                  totalMinor: l.totalMinor,
                  promotionId: l.promotionId,
                  promotionDiscountMinor: l.promotionDiscountMinor,
                  promotionLabel: l.promotionLabel,
                })),
              };
            } else {
              const res = this.computeAndValidateTotals(dto, lineInputs, pricesIncludeTax);
              calculated = res.calculated;
            }

            const paid = dto.payments.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
            let change = 0n;
            let due = 0n;
            if (paid > calculated.totalMinor) {
              change = paid - calculated.totalMinor;
              const cashPaid = dto.payments.filter((p) => p.paymentMethod === "cash").reduce((s, p) => s + BigInt(p.amountMinor), 0n);
              if (change > cashPaid) {
                throw new UnprocessableEntityException({
                  code: "NON_CASH_OVERPAYMENT_PROHIBITED",
                  message: "Non-cash payments cannot generate cash change",
                });
              }
            } else if (paid < calculated.totalMinor) {
              due = calculated.totalMinor - paid;
            }
            paidMinor = paid;
            changeMinor = change;
            dueMinor = due;
          } else {
            // Totals mismatch
            if (!dto.isOffline) {
              throw new UnprocessableEntityException({
                code: "CALCULATION_MISMATCH",
                message: "Totals mismatch: client total differs from server recomputation",
                details: [{
                  field: "expectedTotalMinor",
                  issue: `Expected total ${dto.expectedTotalMinor} does not match computed total ${serverComputedTotalMinor}`,
                  serverTotalMinor: Number(serverComputedTotalMinor),
                  clientTotalMinor: dto.expectedTotalMinor,
                }],
              });
            }

            // Offline sale whose total differs from today's promotions:
            // Rebuild the sale from the client's applied values.
            const rebuiltLines = dto.items.map((item, idx) => {
              const lineInput = lineInputs[idx];
              const unitPrice = BigInt(lineInput.unitPriceMinor);
              const qtyThousandths = parseQuantityThousandths(lineInput.quantity);
              const gross = roundHalfUp(unitPrice * qtyThousandths, 1000n);
              const promoDisc = BigInt(item.promotionDiscountMinor ?? 0);
              const netAfterLinePromo = gross - promoDisc;

              return {
                lineId: item.lineId || `line-${idx}`,
                variantId: lineInput.variantId,
                unitPriceMinor: unitPrice,
                quantityThousandths: qtyThousandths,
                quantity: formatQuantityFromThousandths(qtyThousandths),
                grossMinor: gross,
                promotionDiscountMinor: promoDisc,
                netAfterLinePromo,
                promotionId: item.promotionId || null,
                promotionLabel: item.promotionLabel || null,
                taxRateBp: lineInput.taxRateBp,
                manualDiscount: item.discount,
              };
            });

            const clientBillPromoDisc = BigInt(dto.billPromotionDiscountMinor ?? 0);
            const allocatedBillPromo = distributeProportional(
              rebuiltLines.map((l) => ({ valueMinor: l.netAfterLinePromo })),
              clientBillPromoDisc,
            );

            const manualLineDiscounts = rebuiltLines.map((l, idx) => {
              const remainingLineNet = l.netAfterLinePromo - allocatedBillPromo[idx];
              if (remainingLineNet <= 0n || !l.manualDiscount) return 0n;
              if (l.manualDiscount.type === "fixed") {
                const amt = BigInt(l.manualDiscount.amountMinor ?? 0);
                return amt > remainingLineNet ? remainingLineNet : amt;
              } else if (l.manualDiscount.type === "percent") {
                const bp = BigInt(l.manualDiscount.percentBp ?? 0);
                const amt = roundHalfUp(remainingLineNet * bp, 10000n);
                return amt > remainingLineNet ? remainingLineNet : amt;
              }
              return 0n;
            });

            const postManualLineSubtotal = rebuiltLines.reduce((acc, l, idx) => {
              const net = l.netAfterLinePromo - allocatedBillPromo[idx] - manualLineDiscounts[idx];
              return acc + (net > 0n ? net : 0n);
            }, 0n);

            let manualBillDiscountMinor = 0n;
            if (dto.billDiscount && postManualLineSubtotal > 0n) {
              if (dto.billDiscount.type === "fixed") {
                const amt = BigInt(dto.billDiscount.amountMinor ?? 0);
                manualBillDiscountMinor = amt > postManualLineSubtotal ? postManualLineSubtotal : amt;
              } else if (dto.billDiscount.type === "percent") {
                const bp = BigInt(dto.billDiscount.percentBp ?? 0);
                manualBillDiscountMinor = roundHalfUp(postManualLineSubtotal * bp, 10000n);
                if (manualBillDiscountMinor > postManualLineSubtotal) {
                  manualBillDiscountMinor = postManualLineSubtotal;
                }
              }
            }

            const linesForManualBill = rebuiltLines.map((l, idx) => ({
              valueMinor: l.netAfterLinePromo - allocatedBillPromo[idx] - manualLineDiscounts[idx],
            }));
            const allocatedManualBill = distributeProportional(linesForManualBill, manualBillDiscountMinor);

            let totalTaxMinor = 0n;
            const finalLines = rebuiltLines.map((l, idx) => {
              const promoDisc = l.promotionDiscountMinor;
              const billPromoDisc = allocatedBillPromo[idx];
              const manualLine = manualLineDiscounts[idx];
              const manualBill = allocatedManualBill[idx];
              const totalLineDisc = promoDisc + manualLine;
              const effectiveLineNet = l.grossMinor - totalLineDisc - billPromoDisc - manualBill;

              let taxMinor = 0n;
              if (l.taxRateBp > 0 && effectiveLineNet > 0n) {
                const rate = BigInt(l.taxRateBp);
                if (pricesIncludeTax) {
                  taxMinor = roundHalfUp(effectiveLineNet * rate, 10000n + rate);
                } else {
                  taxMinor = roundHalfUp(effectiveLineNet * rate, 10000n);
                }
              }
              totalTaxMinor += taxMinor;

              const total = pricesIncludeTax ? effectiveLineNet : effectiveLineNet + taxMinor;

              return {
                lineId: l.lineId,
                variantId: l.variantId,
                quantity: l.quantity,
                unitPriceMinor: l.unitPriceMinor,
                grossMinor: l.grossMinor,
                lineDiscountMinor: totalLineDisc,
                allocatedBillDiscountMinor: billPromoDisc + manualBill,
                effectiveLineNetMinor: effectiveLineNet,
                taxRateBp: l.taxRateBp,
                taxMinor,
                totalMinor: total,
                promotionId: l.promotionId,
                promotionDiscountMinor: promoDisc,
                promotionLabel: l.promotionLabel,
              };
            });

            const grossMinor = finalLines.reduce((acc, l) => acc + l.grossMinor, 0n);
            const lineDiscountMinor = finalLines.reduce((acc, l) => acc + l.lineDiscountMinor, 0n);
            const billDiscountMinor = clientBillPromoDisc + manualBillDiscountMinor;
            const totalDiscountMinor = lineDiscountMinor + billDiscountMinor;
            const netMinor = grossMinor - totalDiscountMinor;
            const totalMinor = finalLines.reduce((acc, l) => acc + l.totalMinor, 0n);

            const rebuiltCalculated = {
              grossMinor,
              totalDiscountMinor,
              lineDiscountMinor,
              billDiscountMinor,
              taxMinor: totalTaxMinor,
              netMinor,
              totalMinor,
              lines: finalLines,
            };

            if (rebuiltCalculated.totalMinor !== BigInt(dto.expectedTotalMinor)) {
              throw new UnprocessableEntityException({
                code: "TOTALS_MISMATCH",
                message: "Totals mismatch: client total differs from server recomputation",
                details: [{
                  field: "expectedTotalMinor",
                  issue: `Expected total ${dto.expectedTotalMinor} does not match computed total ${rebuiltCalculated.totalMinor}`,
                  serverTotalMinor: Number(rebuiltCalculated.totalMinor),
                  clientTotalMinor: dto.expectedTotalMinor,
                }],
              });
            }

            calculated = rebuiltCalculated;
            billPromotionId = dto.billPromotionId || null;
            billPromotionDiscountMinor = clientBillPromoDisc;

            const serverAppliedPromos: any[] = promoEval?.appliedPromotions || [];
            const serverAppliedMap = new Map<string, bigint>();
            for (const sp of serverAppliedPromos) {
              serverAppliedMap.set(sp.id, sp.discountMinor);
            }

            const clientPromoDiscMap = new Map<string, bigint>();
            for (const fl of finalLines) {
              if (fl.promotionId && fl.promotionDiscountMinor > 0n) {
                clientPromoDiscMap.set(fl.promotionId, (clientPromoDiscMap.get(fl.promotionId) || 0n) + fl.promotionDiscountMinor);
              }
            }
            if (dto.billPromotionId && clientBillPromoDisc > 0n) {
              clientPromoDiscMap.set(dto.billPromotionId, (clientPromoDiscMap.get(dto.billPromotionId) || 0n) + clientBillPromoDisc);
            }

            const differingIds = new Set<string>();
            for (const [id, cDisc] of clientPromoDiscMap.entries()) {
              const sDisc = serverAppliedMap.get(id);
              if (sDisc === undefined || sDisc !== cDisc) {
                differingIds.add(id);
              }
            }
            for (const id of serverAppliedMap.keys()) {
              if (!clientPromoDiscMap.has(id)) {
                differingIds.add(id);
              }
            }

            priceFlags.push({
              flag: "PROMOTION_CHANGED",
              details: {
                clientTotalMinor: dto.expectedTotalMinor,
                clientExpectedTotalMinor: dto.expectedTotalMinor,
                serverTotalMinor: Number(serverComputedTotalMinor),
                serverPromotionDiscountMinor: Number(serverPromotionDiscountMinor),
                differingPromotionIds: Array.from(differingIds),
              },
            });

            appliedPromoSummary = Array.from(clientPromoDiscMap.entries()).map(([id, discountMinor]) => ({
              id,
              discountMinor,
            }));

            const paid = dto.payments.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
            let change = 0n;
            let due = 0n;
            if (paid > calculated.totalMinor) {
              change = paid - calculated.totalMinor;
              const cashPaid = dto.payments.filter((p) => p.paymentMethod === "cash").reduce((s, p) => s + BigInt(p.amountMinor), 0n);
              if (change > cashPaid) {
                throw new UnprocessableEntityException({
                  code: "NON_CASH_OVERPAYMENT_PROHIBITED",
                  message: "Non-cash payments cannot generate cash change",
                });
              }
            } else if (paid < calculated.totalMinor) {
              due = calculated.totalMinor - paid;
            }
            paidMinor = paid;
            changeMinor = change;
            dueMinor = due;
          }
        } else {
          const res = this.computeAndValidateTotals(dto, lineInputs, pricesIncludeTax);
          calculated = res.calculated;
          paidMinor = res.paidMinor;
          changeMinor = res.changeMinor;
          dueMinor = res.dueMinor;
        }

        const reviewFlags: Array<{ flag: string; details?: any }> = [...priceFlags];

        if (isShiftClosed) {
          reviewFlags.push({ flag: "SHIFT_CLOSED", details: { shiftId: shift.id, closedAt: shift.closedAt } });
        }

        if (dto.isOffline) {
          const cashier = await tx.user.findUnique({
            where: { id: userId },
            include: { userRoles: { include: { role: { include: { rolePermissions: true } } } } },
          });
          if (!cashier || !cashier.isActive) {
            reviewFlags.push({ flag: "PERMISSION_CHANGED", details: { reason: "Cashier user deactivated or deleted", cashierUserId: userId } });
          } else {
            const hasSaleCreate = cashier.userRoles.some((ur) =>
              ur.role.rolePermissions.some((rp) => rp.permissionKey === "sale.create" || rp.permissionKey === "*")
            );
            if (!hasSaleCreate) {
              reviewFlags.push({ flag: "PERMISSION_CHANGED", details: { reason: "Cashier user lost sale.create permission", cashierUserId: userId } });
            }
          }
        }

        if (dueMinor > 0n) {
          if (!dto.customerId) {
            throw new BadRequestException("Customer is required for credit / due sales");
          }
          if (dto.isOffline) {
            throw new BadRequestException("Credit sales are not supported offline");
          }
          const canSellCredit = Boolean(
            user?.isOwner ||
              user?.permissions?.includes("sale.credit") ||
              user?.permissions?.includes("*"),
          );
          if (!canSellCredit) {
            throw new ForbiddenException("Credit sales require sale.credit permission");
          }
          const balance = await this.customersService.getBalance(tenantId, dto.customerId, tx);
          const currentDueMinor = balance.currentDueMinor;
          const creditLimitMinor = balance.creditLimitMinor;
          const willExceed = (BigInt(currentDueMinor) + dueMinor) > BigInt(creditLimitMinor);
          const canOverrideCredit = Boolean(
            user?.isOwner ||
              user?.permissions?.includes("sale.credit.override") ||
              user?.permissions?.includes("*"),
          );
          if (willExceed && !canOverrideCredit) {
            throw new ConflictException({
              code: "CREDIT_LIMIT_EXCEEDED",
              message: `Customer credit limit exceeded. Limit: ৳${(creditLimitMinor / 100).toFixed(2)}, Current Due: ৳${(currentDueMinor / 100).toFixed(2)}, Attempted Due: ৳${(Number(dueMinor) / 100).toFixed(2)}`,
              limitMinor: creditLimitMinor,
              currentDueMinor,
              attemptedDueMinor: Number(dueMinor),
            });
          }
        }

        const ov = await enforceDiscountAndOverrideLimits(
          tx, userId, tenantId, dto, lineInputs, user,
          { grossMinor: calculated.grossMinor, totalDiscountMinor: calculated.totalDiscountMinor },
          Boolean(dto.isOffline),
        );

        if (ov.discountOverLimit) {
          reviewFlags.push({
            flag: "DISCOUNT_OVER_LIMIT",
            details: {
              limitPercent: ov.discountOverLimit.limitBp / 100,
              attemptedPercent: ov.discountOverLimit.attemptedBp / 100,
              limitBp: ov.discountOverLimit.limitBp,
              attemptedBp: ov.discountOverLimit.attemptedBp,
            },
          });
        }

        let inv: string;
        if (dto.isOffline) {
          if (!dto.invoiceNumber) {
            throw new BadRequestException("Offline invoice number is required for offline sales");
          }
          const regCode = shift.register.code;
          const offlinePattern = new RegExp(`^${regCode}-O-\\d{6}-\\d{4}$`);
          if (!offlinePattern.test(dto.invoiceNumber)) {
            throw new UnprocessableEntityException({
              code: "INVALID_OFFLINE_INVOICE_NUMBER",
              message: `Offline invoice number '${dto.invoiceNumber}' does not match register ${regCode} or format ${regCode}-O-YYMMDD-NNNN`,
            });
          }
          const existingInv = await tx.sale.findUnique({
            where: { tenantId_invoiceNumber: { tenantId, invoiceNumber: dto.invoiceNumber } },
          });
          if (existingInv && existingInv.id !== dto.id) {
            throw new ConflictException({
              code: "OFFLINE_NUMBER_TAKEN",
              message: `Invoice number ${dto.invoiceNumber} is already taken`,
            });
          }
          inv = dto.invoiceNumber;
        } else {
          inv = await this.generateInvoiceNumber(tenantId, shift.registerId, tx, timeZone);
        }

        let occurredAt = dto.isOffline && dto.occurredAt ? new Date(dto.occurredAt) : new Date();
        if (dto.isOffline) {
          if (occurredAt < shift.openedAt) occurredAt = shift.openedAt;
          if (shift.closedAt && occurredAt > shift.closedAt) occurredAt = shift.closedAt;
        }
        const syncedAt = dto.isOffline ? new Date() : null;
        const isOffline = Boolean(dto.isOffline);
        const catalogVersion = dto.catalogVersion || null;

        const saleId = dto.id;
        const costMap = new Map(variants.map((v) => [v.id, v.costMinor]));

        const sale = await this.executeSaleInsert(tx, tenantId, dto, {
          saleId, inv, calc: calculated, paid: paidMinor, change: changeMinor, due: dueMinor,
          userId, costMap, originalPrices, payloadHash, occurredAt, syncedAt, isOffline, catalogVersion,
          billPromotionId, billPromotionDiscountMinor, couponCode: dto.couponCode || null,
        });

        if (appliedPromoSummary.length > 0) {
          for (const ap of appliedPromoSummary) {
            await tx.promotion.update({
              where: { id: ap.id },
              data: {
                totalUses: { increment: 1 },
                totalDiscountMinor: { increment: ap.discountMinor },
              },
            });
          }
        }

        if (lockedCoupon) {
          await tx.$executeRaw`
            UPDATE coupons
            SET times_used = times_used + 1, updated_at = NOW()
            WHERE id = ${lockedCoupon.id}::uuid;
          `;
          await tx.couponUsage.create({
            data: {
              id: uuidv7(),
              tenantId,
              couponId: lockedCoupon.id,
              saleId,
              customerId: dto.customerId || null,
            },
          });
        }

        const { negativeStockItems } = await this.finalizeSaleOperations(tx, tenantId, {
          saleId, inv, calc: calculated, branchId: dto.branchId, customerId: dto.customerId || undefined, userId, ip, costMap, isOffline,
        });

        if (negativeStockItems && negativeStockItems.length > 0) {
          for (const neg of negativeStockItems) {
            reviewFlags.push({
              flag: "NEGATIVE_STOCK",
              details: { variantId: neg.variantId, branchId: neg.branchId, remainingQty: neg.newQty },
            });
          }
        }

        if (reviewFlags.length > 0) {
          for (const rf of reviewFlags) {
            await tx.saleReviewFlag.create({
              data: {
                id: uuidv7(),
                tenantId,
                saleId,
                flag: rf.flag,
                details: rf.details ? rf.details : Prisma.JsonNull,
                status: "open",
              },
            });
          }
        }

        await this.handleOverrideAudit(tx, tenantId, userId, saleId, inv, ov, ip);
        return sale;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        return this.handleSaleCreationConflict(tenantId, dto, payloadHash);
      }
      throw err;
    }
  }

  async voidSale(tenantId: string, saleId: string, dto: VoidSaleDto, userId: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true, shift: true } });
      if (!sale || sale.tenantId !== tenantId) throw new NotFoundException("Sale not found");
      if (sale.status === "voided") throw new BadRequestException("Sale is already voided");
      const returnCount = await tx.saleReturn.count({ where: { saleId } });
      if (returnCount > 0) {
        throw new BadRequestException("Cannot void a sale that has returns");
      }
      if (sale.shift && sale.shift.status === "closed") {
        throw new ConflictException({
          code: "SHIFT_ALREADY_CLOSED",
          message: "Cannot void sale: associated shift is already closed",
        });
      }

      const voided = await tx.sale.update({
        where: { id: saleId },
        data: { status: "voided", voidReason: dto.reason, voidedAt: new Date(), voidedByUserId: userId },
      });

      await this.inventoryService.applyMovements(
        tenantId, tx,
        sale.items.map((it) => ({
          branchId: sale.branchId, variantId: it.variantId, qtyDelta: Number(it.quantity),
          unitCostMinor: it.unitCostMinor,
          type: "sale_void", refType: "sale_void", refId: saleId,
          reason: `Void sale ${sale.invoiceNumber}: ${dto.reason}`, actorUserId: userId,
        })),
      );

      await this.updateCustomerMetrics(tx, sale.customerId || undefined, sale.totalMinor, true);
      await this.auditService.log({
        tenantId, actorUserId: userId, action: "sale.void", entityType: "sale", entityId: saleId,
        before: { status: "completed" }, after: { status: "voided", reason: dto.reason }, ip,
      }, tx);
      return voided;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          items: {
            include: {
              variant: { select: { id: true, sku: true, product: { select: { id: true, name: true } } } },
              returnItems: { select: { quantity: true, totalRefundMinor: true } },
            },
          },
          payments: true,
          customer: true,
          cashierUser: { select: { id: true, name: true } },
          returns: {
            include: {
              items: true,
              cashierUser: { select: { id: true, name: true } },
            },
            orderBy: { createdAt: "desc" },
          },
        },
      });
      if (!sale || sale.tenantId !== tenantId) throw new NotFoundException("Sale not found");

      const enrichedItems = sale.items.map((item) => {
        const returnedQty = item.returnItems.reduce((sum, ri) => sum + Number(ri.quantity), 0);
        const soldQty = Number(item.quantity);
        const returnableQty = Math.max(0, soldQty - returnedQty);
        return {
          ...item,
          returnedQuantity: returnedQty,
          returnableQuantity: returnableQty,
        };
      });

      return {
        ...sale,
        items: enrichedItems,
      };
    });
  }

  async findMany(
    tenantId: string,
    query: {
      branchId?: string;
      shiftId?: string;
      status?: string;
      cashierId?: string;
      paymentMethod?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SaleWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;
      if (query.shiftId) where.shiftId = query.shiftId;
      if (query.status) where.status = query.status;
      if (query.cashierId) where.cashierUserId = query.cashierId;
      if (query.paymentMethod) {
        where.payments = { some: { paymentMethod: query.paymentMethod } };
      }
      if (query.search) {
        where.OR = [
          { invoiceNumber: { contains: query.search, mode: "insensitive" } },
          { offlineInvoiceNumber: { contains: query.search, mode: "insensitive" } },
        ];
      }
      if (query.startDate || query.endDate) {
        where.occurredAt = {};
        if (query.startDate) where.occurredAt.gte = new Date(query.startDate);
        if (query.endDate) where.occurredAt.lte = new Date(query.endDate);
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["occurredAt", "createdAt", "invoiceNumber", "totalMinor"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "occurredAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, items] = await Promise.all([
        tx.sale.count({ where }),
        tx.sale.findMany({
          where,
          skip,
          take: limit,
          include: {
            items: true,
            payments: true,
            customer: { select: { id: true, name: true, phone: true } },
          },
          orderBy: { [sortBy]: sortOrder },
        }),
      ]);
      return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    });
  }

  async getOfflineReviewFlags(
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      status?: string;
      flag?: string;
      branchId?: string;
    } = {},
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SaleReviewFlagWhereInput = { tenantId };
      if (query.status && query.status !== "all") {
        where.status = query.status;
      }
      if (query.flag) {
        where.flag = query.flag;
      }
      if (query.branchId) {
        where.sale = { branchId: query.branchId };
      }

      const [total, flags] = await Promise.all([
        tx.saleReviewFlag.count({ where }),
        tx.saleReviewFlag.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
          include: {
            sale: {
              include: {
                cashierUser: { select: { id: true, name: true, email: true } },
                branch: { select: { id: true, name: true, code: true } },
                items: {
                  include: {
                    variant: { include: { product: true } },
                  },
                },
              },
            },
            resolvedByUser: { select: { id: true, name: true, email: true } },
          },
        }),
      ]);

      return {
        items: flags,
        data: flags,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async resolveOfflineReviewFlag(
    tenantId: string,
    flagId: string,
    dto: { notes?: string },
    userId: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const flag = await tx.saleReviewFlag.findUnique({
        where: { id: flagId },
      });
      if (!flag || flag.tenantId !== tenantId) {
        throw new NotFoundException("Review flag not found");
      }
      if (flag.status === "resolved") {
        return flag;
      }

      const updated = await tx.saleReviewFlag.update({
        where: { id: flagId },
        data: {
          status: "resolved",
          resolvedAt: new Date(),
          resolvedByUserId: userId,
          resolutionNotes: dto.notes || null,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "sale.offline_review_resolve",
          entityType: "sale_review_flag",
          entityId: flagId,
          after: { status: "resolved", notes: dto.notes },
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async getOfflineReviewCount(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const count = await tx.saleReviewFlag.count({
        where: { tenantId, status: "open" },
      });
      return { count };
    });
  }
}
