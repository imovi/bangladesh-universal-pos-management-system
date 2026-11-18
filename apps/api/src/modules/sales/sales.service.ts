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
import { CreateSaleDto, VoidSaleDto, calculateSaleTotals, formatDateKey } from "@universal-pos/shared";
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

  private async checkIdempotency(
    tx: Prisma.TransactionClient, id: string, tenantId: string, dto: CreateSaleDto, payloadHash: string,
  ) {
    const existing = await tx.sale.findUnique({ where: { id }, include: { items: true, payments: true } });
    if (!existing || existing.tenantId !== tenantId) return null;
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
      discountMinor: l.lineDiscountMinor + l.allocatedBillDiscountMinor,
      taxRateBp: l.taxRateBp, taxMinor: l.taxMinor, totalMinor: l.totalMinor,
    }));
  }

  private async executeSaleInsert(
    tx: Prisma.TransactionClient, tenantId: string, dto: CreateSaleDto,
    meta: {
      saleId: string; inv: string; calc: any; paid: bigint; change: bigint; due: bigint;
      userId: string; costMap: Map<string, bigint>; originalPrices: (bigint | null)[]; payloadHash: string;
      occurredAt: Date; syncedAt: Date | null; isOffline: boolean; catalogVersion: string | null;
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
          dto.catalogVersion,
        );
        const { calculated, paidMinor, changeMinor, dueMinor } = this.computeAndValidateTotals(dto, lineInputs, pricesIncludeTax);

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
        });

        const { negativeStockItems } = await this.finalizeSaleOperations(tx, tenantId, {
          saleId, inv, calc: calculated, branchId: dto.branchId, customerId: dto.customerId, userId, ip, costMap, isOffline,
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
        where.invoiceNumber = { contains: query.search, mode: "insensitive" };
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
