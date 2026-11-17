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
import { ExchangesService } from "./exchanges.service.js";
import {
  CreateSaleReturnDto,
  CreateSaleExchangeDto,
  ListReturnsQueryDto,
  calculateLineReturnRefund,
  parseQuantityThousandths,
  calculateShiftCashTotals,
  roundHalfUp,
  parseDateFilterRange,
} from "@universal-pos/shared";
import {
  lockSaleItems,
  generateReturnNumber,
} from "./returns-common.helper.js";

@Injectable()
export class ReturnsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly systemDb: SystemDbService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly exchangesService: ExchangesService,
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

      // 2. Load and validate original sale (enforce tenant isolation)
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
        throw new BadRequestException("Cannot return items from a voided sale");
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
        throw new BadRequestException("Active open shift required for return");
      }

      // 4. Return Window Check
      const saleAgeMs = Date.now() - sale.createdAt.getTime();
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

      // 5. Lock sale lines in deterministic sorted order
      const itemIds = dto.items.map((it) => it.saleItemId);
      await lockSaleItems(tx, itemIds);

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

      // 7. Calculate Pro-Rata Refund per Line
      let totalRefundMinor = 0n;
      let totalTaxRefundMinor = 0n;
      const returnItemsData: any[] = [];
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

        if (agg.returnedQtyThousandths + returningQtyThousandths > soldQtyThousandths) {
          throw new ConflictException({
            code: "OVER_RETURN_PROHIBITED",
            message: `Requested return quantity exceeds remaining returnable quantity for line ${item.saleItemId}`,
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
        totalTaxRefundMinor += refundCalc.taxRefundMinor;

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
            branchId: sale.branchId,
            variantId: saleItem.variantId,
            qtyDelta: Number(item.quantity),
            type: "sale_return",
            refType: "sale_return",
            refId: returnId,
            reason: `Sale return ${sale.invoiceNumber}`,
            actorUserId: userId,
          });
        } else {
          stockMovementsToApply.push({
            branchId: sale.branchId,
            variantId: saleItem.variantId,
            qtyDelta: 0,
            type: "sale_return_damaged",
            refType: "sale_return",
            refId: returnId,
            reason: `Damaged return: ${item.quantity} units from ${sale.invoiceNumber}`,
            actorUserId: userId,
          });
        }
      }

      // 8. Automatic Due Reduction on Credit Sales
      let dueReducedMinor = 0n;
      let netCashRefundMinor = totalRefundMinor;

      if (sale.dueMinor && sale.dueMinor > 0n) {
        dueReducedMinor = totalRefundMinor < sale.dueMinor ? totalRefundMinor : sale.dueMinor;
        netCashRefundMinor = totalRefundMinor - dueReducedMinor;

        await tx.sale.update({
          where: { id: sale.id },
          data: {
            dueMinor: {
              decrement: dueReducedMinor,
            },
          },
        });
      }

      // 9. Drawer Cash Check for Cash Refunds
      if (dto.refundMethod === "cash" && netCashRefundMinor > 0n) {
        const shiftCalc = calculateShiftCashTotals({
          openingCashMinor: shift.openingCashMinor,
          cashMovements: shift.cashMovements,
          sales: shift.sales,
          returns: shift.returns,
          customerPayments: shift.customerPayments,
        });
        if (netCashRefundMinor > shiftCalc.expectedCashMinor) {
          throw new ConflictException({
            code: "DRAWER_CASH_EXCEEDED",
            message: `Cash refund of ${netCashRefundMinor} poisha exceeds current drawer cash of ${shiftCalc.expectedCashMinor} poisha`,
          });
        }
      }

      // 10. Generate sequential return number
      const returnNumber = await generateReturnNumber(
        tenantId,
        shift.registerId,
        tx,
        timeZone,
      );

      // Append metadata to reason so shift calculations track due deductions
      const reasonWithMeta =
        dueReducedMinor > 0n
          ? `${dto.reason || "Customer return"} [due_reduced:${dueReducedMinor}]`
          : dto.reason || "Customer return";

      // 11. Create SaleReturn record
      const saleReturn = await tx.saleReturn.create({
        data: {
          id: returnId,
          tenantId,
          returnNumber,
          saleId,
          shiftId: dto.shiftId,
          branchId: sale.branchId,
          registerId: shift.registerId,
          cashierUserId: userId,
          refundMethod: dto.refundMethod,
          totalRefundMinor,
          taxRefundMinor: totalTaxRefundMinor,
          reason: reasonWithMeta,
          overrideReason,
          overrideByUserId,
          requestPayloadHash: payloadHash,
          items: {
            create: returnItemsData,
          },
        },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
        },
      });

      // 12. Apply inventory movements
      await this.inventoryService.applyMovements(tenantId, tx, stockMovementsToApply);

      // 13. Update customer metrics if customer attached
      if (sale.customerId) {
        await tx.customer.update({
          where: { id: sale.customerId },
          data: {
            totalSpentMinor: {
              decrement: totalRefundMinor,
            },
          },
        });
      }

      // 14. Audit Log
      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "sale.return",
          entityType: "sale",
          entityId: saleId,
          after: {
            returnNumber,
            invoiceNumber: sale.invoiceNumber,
            totalRefundMinor: Number(totalRefundMinor),
            refundMethod: dto.refundMethod,
            itemsCount: dto.items.length,
            dueReducedMinor: Number(dueReducedMinor),
            netCashRefundMinor: Number(netCashRefundMinor),
          },
          ip,
        },
        tx,
      );

      return {
        ...saleReturn,
        dueReducedMinor: Number(dueReducedMinor),
        netCashRefundMinor: Number(netCashRefundMinor),
      };
    });
  }

  async createExchange(
    tenantId: string,
    dto: CreateSaleExchangeDto,
    userId: string,
    ip?: string,
    user?: { isOwner?: boolean; permissions?: string[] },
  ) {
    return this.exchangesService.createExchange(tenantId, dto, userId, ip, user);
  }

  async findMany(tenantId: string, query: ListReturnsQueryDto) {
    const tz = (await this.getTenantSettings(tenantId)).timeZone;
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      // Cross-tenant verification: if saleId provided, verify it belongs to tenant
      if (query.saleId) {
        const sale = await tx.sale.findFirst({
          where: { id: query.saleId, tenantId },
        });
        if (!sale) {
          throw new NotFoundException("Sale not found");
        }
      }

      const where: Prisma.SaleReturnWhereInput = { tenantId };

      if (query.branchId) where.branchId = query.branchId;
      if (query.shiftId) where.shiftId = query.shiftId;
      if (query.saleId) where.saleId = query.saleId;

      const dateRange = parseDateFilterRange(query.startDate, query.endDate, tz);
      if (dateRange.gte || dateRange.lte) {
        where.createdAt = {};
        if (dateRange.gte) where.createdAt.gte = dateRange.gte;
        if (dateRange.lte) where.createdAt.lte = dateRange.lte;
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
            items: {
              include: {
                variant: {
                  select: {
                    id: true,
                    sku: true,
                    product: { select: { id: true, name: true } },
                    optionValues: {
                      include: { optionValue: true },
                    },
                  },
                },
              },
            },
            sale: { select: { id: true, invoiceNumber: true } },
            branch: { select: { id: true, name: true, code: true } },
            cashierUser: { select: { id: true, name: true, email: true } },
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
                  optionValues: {
                    include: { optionValue: true },
                  },
                },
              },
            },
          },
          sale: {
            include: {
              customer: true,
              branch: true,
              cashierUser: true,
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

  async findBySaleId(tenantId: string, saleId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const sale = await tx.sale.findFirst({
        where: { id: saleId, tenantId },
      });
      if (!sale) {
        throw new NotFoundException("Sale not found");
      }

      return tx.saleReturn.findMany({
        where: { saleId, tenantId },
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });
    });
  }
}
