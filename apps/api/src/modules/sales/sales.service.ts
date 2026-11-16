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

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantContext: TenantContextService, private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService, private readonly systemDb: SystemDbService,
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
  ) {
    const canOverride = Boolean(
      user?.isOwner ||
        user?.permissions?.includes("sale.price_override") ||
        user?.permissions?.includes("*"),
    );

    const originalPrices: (bigint | null)[] = [];

    const lineInputs = items.map((it) => {
      const v = variantMap.get(it.variantId);
      if (!v || !v.isActive || !v.product || !v.product.isActive) {
        throw new UnprocessableEntityException({
          code: "INACTIVE_PRODUCT_OR_VARIANT",
          message: `Variant ${it.variantId} or its product is inactive or not found`,
        });
      }

      let unitPriceMinor = v.priceMinor;
      if (it.overrideUnitPriceMinor !== undefined) {
        if (!canOverride) {
          throw new ForbiddenException("Price override requires sale.price_override permission");
        }
        originalPrices.push(v.priceMinor);
        unitPriceMinor = BigInt(it.overrideUnitPriceMinor);
      } else {
        originalPrices.push(null);
      }

      const taxRateBp = v.product.taxClass ? v.product.taxClass.rateBp : defaultTaxRateBp;
      return { variantId: it.variantId, unitPriceMinor, quantity: it.quantity, discount: it.discount, taxRateBp };
    });

    return { lineInputs, originalPrices };
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
        code: "CALCULATION_MISMATCH",
        message: "Calculation mismatch: client total differs from server recomputation",
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
    if (paidMinor < calculated.totalMinor) {
      throw new BadRequestException(`Insufficient payment: paid ${paidMinor}, required ${calculated.totalMinor}`);
    }

    const cashPaidMinor = dto.payments.filter((p) => p.paymentMethod === "cash").reduce((s, p) => s + BigInt(p.amountMinor), 0n);
    const changeMinor = paidMinor - calculated.totalMinor;
    if (changeMinor > cashPaidMinor) {
      throw new UnprocessableEntityException({
        code: "NON_CASH_OVERPAYMENT_PROHIBITED",
        message: "Non-cash payments cannot generate cash change",
      });
    }

    return { calculated, paidMinor, changeMinor };
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
    meta: { saleId: string; inv: string; calc: any; paid: bigint; change: bigint; userId: string; costMap: Map<string, bigint>; originalPrices: (bigint | null)[]; payloadHash: string },
  ) {
    return tx.sale.create({
      data: {
        id: meta.saleId, tenantId, invoiceNumber: meta.inv, shiftId: dto.shiftId,
        branchId: dto.branchId, cashierUserId: meta.userId, customerId: dto.customerId,
        status: "completed", subtotalMinor: meta.calc.grossMinor, discountMinor: meta.calc.totalDiscountMinor,
        taxMinor: meta.calc.taxMinor, totalMinor: meta.calc.totalMinor, paidMinor: meta.paid,
        changeMinor: meta.change, notes: dto.notes, requestPayloadHash: meta.payloadHash,
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
    if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
      throw new BadRequestException("Active open shift required for sale");
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
    return { shift, defaultTaxRateBp: defaultTax?.rateBp ?? 0, variants };
  }

  private async finalizeSaleOperations(
    tx: Prisma.TransactionClient,
    tenantId: string,
    meta: { saleId: string; inv: string; calc: any; branchId: string; customerId?: string; userId: string; ip?: string; costMap: Map<string, bigint> },
  ) {
    await this.inventoryService.applyMovements(
      tenantId, tx,
      meta.calc.lines.map((l: any) => ({
        branchId: meta.branchId, variantId: l.variantId, qtyDelta: -Number(l.quantity),
        unitCostMinor: meta.costMap.get(l.variantId) ?? 0n,
        type: "sale", refType: "sale", refId: meta.saleId, reason: `Sale ${meta.inv}`, actorUserId: meta.userId,
      })),
    );
    await this.updateCustomerMetrics(tx, meta.customerId, meta.calc.totalMinor, false);
    await this.auditService.log(
      {
        tenantId, actorUserId: meta.userId, action: "sale.create", entityType: "sale", entityId: meta.saleId,
        after: { invoiceNumber: meta.inv, totalMinor: Number(meta.calc.totalMinor), itemsCount: meta.calc.lines.length }, ip: meta.ip,
      },
      tx,
    );
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

        const { shift, defaultTaxRateBp, variants } = await this.loadShiftAndVariants(tx, tenantId, dto);
        const variantMap = new Map(variants.map((v) => [v.id, v]));
        const { lineInputs, originalPrices } = this.resolveItemPricingAndTaxes(dto.items, variantMap, defaultTaxRateBp, user);
        const { calculated, paidMinor, changeMinor } = this.computeAndValidateTotals(dto, lineInputs, pricesIncludeTax);
        const ov = await enforceDiscountAndOverrideLimits(
          tx, userId, tenantId, dto, lineInputs, user,
          { grossMinor: calculated.grossMinor, totalDiscountMinor: calculated.totalDiscountMinor },
        );

        const saleId = dto.id;
        const inv = await this.generateInvoiceNumber(tenantId, shift.registerId, tx, timeZone);
        const costMap = new Map(variants.map((v) => [v.id, v.costMinor]));

        const sale = await this.executeSaleInsert(tx, tenantId, dto, {
          saleId, inv, calc: calculated, paid: paidMinor, change: changeMinor,
          userId, costMap, originalPrices, payloadHash,
        });

        await this.finalizeSaleOperations(tx, tenantId, {
          saleId, inv, calc: calculated, branchId: dto.branchId, customerId: dto.customerId, userId, ip, costMap,
        });
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
        where.createdAt = {};
        if (query.startDate) where.createdAt.gte = new Date(query.startDate);
        if (query.endDate) where.createdAt.lte = new Date(query.endDate);
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["createdAt", "invoiceNumber", "totalMinor"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
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
}
