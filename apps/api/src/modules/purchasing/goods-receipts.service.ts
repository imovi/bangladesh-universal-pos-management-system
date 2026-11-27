import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { InventoryService } from "../inventory/inventory.service.js";
import {
  CreateGoodsReceiptDto,
  calculateWeightedAverageCost,
  formatDateKey,
  computeBaseQuantity,
  roundHalfUp,
  parseQuantityThousandths,
} from "@universal-pos/shared";

@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
    private readonly inventoryService: InventoryService,
  ) {}

  private async generateGrnNumber(
    tenantId: string,
    tx: Prisma.TransactionClient,
    timeZone = "Asia/Dhaka",
  ): Promise<string> {
    const dateKey = formatDateKey(new Date(), timeZone);
    await tx.$executeRaw`
      INSERT INTO document_counters (id, tenant_id, doc_type, date_key, last_seq, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, 'GRN', ${dateKey}, 0, NOW())
      ON CONFLICT (tenant_id, doc_type, date_key) DO NOTHING;
    `;
    const counters = await tx.$queryRaw<{ last_seq: number }[]>`
      SELECT last_seq FROM document_counters
      WHERE tenant_id = ${tenantId}::uuid AND doc_type = 'GRN' AND date_key = ${dateKey}
      FOR UPDATE;
    `;
    const nextSeq = (counters[0]?.last_seq || 0) + 1;
    await tx.$executeRaw`
      UPDATE document_counters SET last_seq = ${nextSeq}, updated_at = NOW()
      WHERE tenant_id = ${tenantId}::uuid AND doc_type = 'GRN' AND date_key = ${dateKey};
    `;
    return `GRN-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
  }

  private async updateWeightedAverageCost(
    tenantId: string,
    tx: Prisma.TransactionClient,
    branchId: string,
    variantId: string,
    recvQty: number,
    recvCostMinor: number | bigint,
  ): Promise<void> {
    const level = await tx.stockLevel.findUnique({
      where: {
        tenantId_branchId_variantId: {
          tenantId,
          branchId,
          variantId,
        },
      },
    });

    const oldQty = level ? Number(level.qty) : 0;
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
    });
    const oldCost = variant?.costMinor ?? 0n;

    const newAvg = calculateWeightedAverageCost(
      oldQty,
      oldCost,
      recvQty,
      recvCostMinor,
    );

    await tx.productVariant.update({
      where: { id: variantId },
      data: { costMinor: newAvg },
    });
  }

  private async updatePoStatusOnReceipt(
    tenantId: string,
    tx: Prisma.TransactionClient,
    purchaseOrderId: string,
  ): Promise<void> {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { items: true },
    });
    if (!po) return;

    const allFulfilled = po.items.every(
      (item) => Number(item.qtyReceived) >= Number(item.qtyOrdered),
    );
    const newStatus = allFulfilled ? "received" : "partially_received";

    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId },
      data: { status: newStatus },
    });
  }

  private async resolveReceiptItem(
    tenantId: string,
    tx: Prisma.TransactionClient,
    item: CreateGoodsReceiptDto["items"][number],
  ) {
    let unitName = "pcs";
    let unitFactor = 1;
    let productUnitId = item.productUnitId || null;

    const poItemId = (item as any).poItemId || item.purchaseOrderItemId;
    if (item.productUnitId) {
      const unit = await tx.productUnit.findUnique({
        where: { id: item.productUnitId, tenantId },
      });
      if (!unit || !unit.isActive || !unit.isPurchaseUnit) {
        throw new BadRequestException("এককটি ক্রয়ের জন্য প্রযোজ্য বা সক্রিয় নয়।");
      }
      unitName = unit.name;
      unitFactor = Number(unit.factor);
    } else if (poItemId) {
      const poItem = await tx.purchaseOrderItem.findUnique({
        where: { id: poItemId },
      });
      if (poItem) {
        unitName = poItem.unitName || "pcs";
        unitFactor = Number(poItem.unitFactor || 1);
        productUnitId = poItem.productUnitId;
      }
    } else {
      const variant = await tx.productVariant.findUnique({
        where: { id: item.variantId, tenantId },
        include: { product: true },
      });
      if (variant?.product?.baseUnit) {
        unitName = variant.product.baseUnit;
      }
    }

    const baseQtyReceived = computeBaseQuantity(item.qtyReceived, unitFactor);
    const stockMovementUnitCostMinor = roundHalfUp(
      BigInt(item.unitCostMinor) * 1000n,
      parseQuantityThousandths(unitFactor),
    );

    return {
      ...item,
      productUnitId,
      unitName,
      unitFactor,
      baseQtyReceived,
      stockMovementUnitCostMinor,
    };
  }

  private async processReceiptItems(
    tenantId: string,
    tx: Prisma.TransactionClient,
    branchId: string,
    resolvedItems: any[],
  ): Promise<void> {
    for (const item of resolvedItems) {
      await this.updateWeightedAverageCost(
        tenantId,
        tx,
        branchId,
        item.variantId,
        item.baseQtyReceived,
        item.stockMovementUnitCostMinor,
      );

      const poItemId = (item as any).poItemId || item.purchaseOrderItemId;
      if (poItemId) {
        await tx.purchaseOrderItem.update({
          where: { id: poItemId },
          data: {
            qtyReceived: {
              increment: new Prisma.Decimal(item.qtyReceived),
            },
          },
        });
      }
    }
  }

  private async insertGoodsReceipt(
    tenantId: string,
    tx: Prisma.TransactionClient,
    grnId: string,
    grnNumber: string,
    dto: CreateGoodsReceiptDto,
    resolvedItems: any[],
    supplierId?: string,
    userId?: string,
  ) {
    return tx.goodsReceipt.create({
      data: {
        id: grnId,
        tenantId,
        grnNumber,
        supplierId: supplierId || null,
        purchaseOrderId: (dto as any).poId || dto.purchaseOrderId,
        branchId: dto.branchId,
        receivedByUserId: userId,
        notes: dto.notes,
        receivedAt: dto.receivedAt || new Date(),
        items: {
          create: resolvedItems.map((item) => ({
            id: uuidv7(),
            tenantId,
            purchaseOrderItemId: item.poItemId || item.purchaseOrderItemId || null,
            variantId: item.variantId,
            productUnitId: item.productUnitId || null,
            unitName: item.unitName,
            unitFactor: new Prisma.Decimal(item.unitFactor),
            baseQtyReceived: new Prisma.Decimal(item.baseQtyReceived),
            qtyReceived: new Prisma.Decimal(item.qtyReceived),
            unitCostMinor: BigInt(item.unitCostMinor),
          })),
        },
      },
      include: { items: true },
    });
  }

  async create(
    tenantId: string,
    dto: CreateGoodsReceiptDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const grnNumber =
        dto.grnNumber || (await this.generateGrnNumber(tenantId, tx));
      const grnId = uuidv7();

      let resolvedSupplierId = dto.supplierId;
      if (dto.purchaseOrderId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: dto.purchaseOrderId },
        });
        if (po) {
          resolvedSupplierId = po.supplierId;
        }
      }

      const resolvedItems = [];
      for (const item of dto.items) {
        resolvedItems.push(await this.resolveReceiptItem(tenantId, tx, item));
      }

      await this.processReceiptItems(tenantId, tx, dto.branchId, resolvedItems);
      const goodsReceipt = await this.insertGoodsReceipt(
        tenantId,
        tx,
        grnId,
        grnNumber,
        dto,
        resolvedItems,
        resolvedSupplierId,
        userId,
      );

      await this.inventoryService.applyMovements(
        tenantId,
        tx,
        resolvedItems.map((item) => ({
          branchId: dto.branchId,
          variantId: item.variantId,
          qtyDelta: item.baseQtyReceived,
          type: "purchase",
          unitCostMinor: item.stockMovementUnitCostMinor,
          refType: "goods_receipt",
          refId: grnId,
          reason: `Goods receipt ${grnNumber}`,
          actorUserId: userId,
        })),
      );

      if (dto.purchaseOrderId) {
        await this.updatePoStatusOnReceipt(tenantId, tx, dto.purchaseOrderId);
      }

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "goods_receipt.create",
          entityType: "goods_receipt",
          entityId: grnId,
          after: {
            grnNumber,
            purchaseOrderId: dto.purchaseOrderId,
            itemsCount: dto.items.length,
          },
          ip,
        },
        tx,
      );

      return goodsReceipt;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const grn = await tx.goodsReceipt.findUnique({
        where: { id },
        include: {
          supplier: { select: { id: true, name: true } },
          branch: true,
          purchaseOrder: true,
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
        },
      });
      if (!grn || grn.tenantId !== tenantId) {
        throw new BadRequestException("Goods receipt not found");
      }
      return grn;
    });
  }

  async findMany(
    tenantId: string,
    query: {
      supplierId?: string;
      purchaseOrderId?: string;
      branchId?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.GoodsReceiptWhereInput = { tenantId };

      if (query.supplierId) {
        where.OR = [
          { supplierId: query.supplierId },
          { purchaseOrder: { supplierId: query.supplierId } },
        ];
      }
      if (query.purchaseOrderId) {
        where.purchaseOrderId = query.purchaseOrderId;
      }
      if (query.branchId) {
        where.branchId = query.branchId;
      }
      if (query.startDate || query.endDate) {
        where.receivedAt = {};
        if (query.startDate) {
          where.receivedAt.gte = new Date(query.startDate);
        }
        if (query.endDate) {
          where.receivedAt.lte = new Date(query.endDate);
        }
      }
      if (query.search) {
        where.grnNumber = { contains: query.search, mode: "insensitive" };
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["receivedAt", "grnNumber", "createdAt"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "receivedAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, items] = await Promise.all([
        tx.goodsReceipt.count({ where }),
        tx.goodsReceipt.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
          include: {
            supplier: { select: { id: true, name: true } },
            purchaseOrder: { select: { id: true, poNumber: true, supplierId: true } },
            branch: { select: { id: true, name: true, code: true } },
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
          },
        }),
      ]);

      return {
        items,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }
}
