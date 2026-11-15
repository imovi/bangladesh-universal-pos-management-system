import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnprocessableEntityException,
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
} from "@universal-pos/shared";
import {
  validateDiscountsNonNegative,
  enforceDiscountAndOverrideLimits,
} from "./sales-discount.helper.js";

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
    private readonly systemDb: SystemDbService,
  ) {}

  private async generateInvoiceNumber(
    tenantId: string,
    registerId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const reg = await tx.register.findUnique({ where: { id: registerId } });
    const regCode = reg?.code || "REG";
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const dateKey = `${yy}${mm}${dd}`;

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
        details: [
          {
            field: "expectedTotalMinor",
            issue: `Expected total ${dto.expectedTotalMinor} does not match computed total ${calculated.totalMinor}`,
            serverTotalMinor: Number(calculated.totalMinor),
            clientTotalMinor: dto.expectedTotalMinor,
            breakdown: {
              grossMinor: Number(calculated.grossMinor),
              discountMinor: Number(calculated.totalDiscountMinor),
              taxMinor: Number(calculated.taxMinor),
              totalMinor: Number(calculated.totalMinor),
              lines: calculated.lines.map((l) => ({
                variantId: l.variantId, unitPriceMinor: Number(l.unitPriceMinor), quantity: l.quantity,
                grossMinor: Number(l.grossMinor), discountMinor: Number(l.lineDiscountMinor + l.allocatedBillDiscountMinor),
                taxMinor: Number(l.taxMinor), totalMinor: Number(l.totalMinor),
              })),
            },
          },
        ],
      });
    }

    const paidMinor = dto.payments.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
    if (paidMinor < calculated.totalMinor) {
      throw new BadRequestException(`Insufficient payment: paid ${paidMinor}, required ${calculated.totalMinor}`);
    }
    return { calculated, paidMinor, changeMinor: paidMinor - calculated.totalMinor };
  }

  private async checkIdempotency(tx: Prisma.TransactionClient, id: string | undefined, tenantId: string) {
    if (!id) return null;
    const existing = await tx.sale.findUnique({
      where: { id },
      include: { items: true, payments: true },
    });
    return existing && existing.tenantId === tenantId ? { ...existing, isDuplicate: true } : null;
  }

  private buildSaleItemsData(
    tenantId: string,
    lines: any[],
    costMap: Map<string, bigint>,
    originalPrices: (bigint | null)[],
  ) {
    return lines.map((l: any, idx: number) => ({
      id: uuidv7(),
      tenantId,
      variantId: l.variantId,
      unitPriceMinor: l.unitPriceMinor,
      originalUnitPriceMinor: originalPrices[idx] ?? null,
      unitCostMinor: costMap.get(l.variantId) ?? 0n,
      quantity: new Prisma.Decimal(l.quantity),
      subtotalMinor: l.grossMinor,
      discountMinor: l.lineDiscountMinor + l.allocatedBillDiscountMinor,
      taxRateBp: l.taxRateBp,
      taxMinor: l.taxMinor,
      totalMinor: l.totalMinor,
    }));
  }

  private async executeSaleInsert(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateSaleDto,
    meta: {
      saleId: string; inv: string; calc: any; paid: bigint; change: bigint;
      userId: string; costMap: Map<string, bigint>; originalPrices: (bigint | null)[];
    },
  ) {
    return tx.sale.create({
      data: {
        id: meta.saleId,
        tenantId,
        invoiceNumber: meta.inv,
        shiftId: dto.shiftId,
        branchId: dto.branchId,
        cashierUserId: meta.userId,
        customerId: dto.customerId,
        status: "completed",
        subtotalMinor: meta.calc.grossMinor,
        discountMinor: meta.calc.totalDiscountMinor,
        taxMinor: meta.calc.taxMinor,
        totalMinor: meta.calc.totalMinor,
        paidMinor: meta.paid,
        changeMinor: meta.change,
        notes: dto.notes,
        items: {
          create: this.buildSaleItemsData(tenantId, meta.calc.lines, meta.costMap, meta.originalPrices),
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
  }

  private async loadShiftAndVariants(tx: Prisma.TransactionClient, tenantId: string, dto: CreateSaleDto) {
    const shift = await tx.shift.findUnique({ where: { id: dto.shiftId } });
    if (!shift || shift.tenantId !== tenantId || shift.status !== "open") {
      throw new BadRequestException("Active open shift required for sale");
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
    meta: { saleId: string; inv: string; calc: any; branchId: string; customerId?: string; userId: string; ip?: string },
  ) {
    await this.inventoryService.applyMovements(
      tenantId, tx,
      meta.calc.lines.map((l: any) => ({
        branchId: meta.branchId, variantId: l.variantId, qtyDelta: -Number(l.quantity),
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

  async create(
    tenantId: string, dto: CreateSaleDto, userId: string, ip?: string,
    user?: { isOwner?: boolean; permissions?: string[] },
  ) {
    const tenant = await this.systemDb.findTenantById(tenantId);
    const tenantSettings = (tenant?.settings as Record<string, unknown>) || {};
    const pricesIncludeTax = (tenantSettings.prices_include_tax as boolean) ?? true;

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const duplicate = await this.checkIdempotency(tx, dto.id, tenantId);
      if (duplicate) return duplicate;

      const { shift, defaultTaxRateBp, variants } = await this.loadShiftAndVariants(tx, tenantId, dto);
      const variantMap = new Map(variants.map((v) => [v.id, v]));
      const { lineInputs, originalPrices } = this.resolveItemPricingAndTaxes(dto.items, variantMap, defaultTaxRateBp, user);

      const { discountOverrideUsed, priceOverrideUsed } = await enforceDiscountAndOverrideLimits(
        tx, userId, tenantId, dto, lineInputs, user,
      );

      const { calculated, paidMinor, changeMinor } = this.computeAndValidateTotals(dto, lineInputs, pricesIncludeTax);

      const saleId = dto.id || uuidv7();
      const invoiceNumber = await this.generateInvoiceNumber(tenantId, shift.registerId, tx);
      const costMap = new Map(variants.map((v) => [v.id, v.costMinor]));

      const sale = await this.executeSaleInsert(tx, tenantId, dto, {
        saleId, inv: invoiceNumber, calc: calculated, paid: paidMinor, change: changeMinor,
        userId, costMap, originalPrices,
      });

      await this.finalizeSaleOperations(tx, tenantId, {
        saleId, inv: invoiceNumber, calc: calculated, branchId: dto.branchId, customerId: dto.customerId, userId, ip,
      });

      if (priceOverrideUsed || discountOverrideUsed) {
        await this.auditService.log(
          {
            tenantId, actorUserId: userId, action: "sale.override", entityType: "sale", entityId: saleId,
            after: { invoiceNumber, priceOverrideUsed, discountOverrideUsed }, ip,
          },
          tx,
        );
      }

      return sale;
    });
  }

  async voidSale(tenantId: string, saleId: string, dto: VoidSaleDto, userId: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({ where: { id: saleId }, include: { items: true } });
      if (!sale || sale.tenantId !== tenantId) throw new NotFoundException("Sale not found");
      if (sale.status === "voided") throw new BadRequestException("Sale is already voided");

      const voided = await tx.sale.update({
        where: { id: saleId },
        data: { status: "voided", voidReason: dto.reason, voidedAt: new Date(), voidedByUserId: userId },
      });

      await this.inventoryService.applyMovements(
        tenantId, tx,
        sale.items.map((it) => ({
          branchId: sale.branchId, variantId: it.variantId, qtyDelta: Number(it.quantity),
          type: "sale_void", refType: "sale_void", refId: saleId,
          reason: `Void sale ${sale.invoiceNumber}: ${dto.reason}`, actorUserId: userId,
        })),
      );

      await this.updateCustomerMetrics(tx, sale.customerId || undefined, sale.totalMinor, true);
      await this.auditService.log(
        {
          tenantId, actorUserId: userId, action: "sale.void", entityType: "sale", entityId: saleId,
          before: { status: "completed" }, after: { status: "voided", reason: dto.reason }, ip,
        },
        tx,
      );
      return voided;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: {
          items: { include: { variant: { select: { id: true, sku: true, product: { select: { id: true, name: true } } } } } },
          payments: true, customer: true, cashierUser: { select: { id: true, name: true } },
        },
      });
      if (!sale || sale.tenantId !== tenantId) throw new NotFoundException("Sale not found");
      return sale;
    });
  }

  async findMany(
    tenantId: string,
    query: { branchId?: string; shiftId?: string; status?: string; page?: number; limit?: number },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SaleWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;
      if (query.shiftId) where.shiftId = query.shiftId;
      if (query.status) where.status = query.status;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.sale.count({ where }),
        tx.sale.findMany({
          where, skip, take: limit,
          include: { items: true, payments: true, customer: { select: { id: true, name: true, phone: true } } },
          orderBy: { createdAt: "desc" },
        }),
      ]);
      return { items, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
    });
  }
}
