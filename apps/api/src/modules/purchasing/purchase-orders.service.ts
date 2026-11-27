import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreatePurchaseOrderDto, formatDateKey, computeBaseQuantity } from "@universal-pos/shared";

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private async generatePoNumber(
    tenantId: string,
    tx: Prisma.TransactionClient,
    timeZone = "Asia/Dhaka",
  ): Promise<string> {
    const dateKey = formatDateKey(new Date(), timeZone);
    await tx.$executeRaw`
      INSERT INTO document_counters (id, tenant_id, doc_type, date_key, last_seq, updated_at)
      VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, 'PO', ${dateKey}, 0, NOW())
      ON CONFLICT (tenant_id, doc_type, date_key) DO NOTHING;
    `;
    const counters = await tx.$queryRaw<{ last_seq: number }[]>`
      SELECT last_seq FROM document_counters
      WHERE tenant_id = ${tenantId}::uuid AND doc_type = 'PO' AND date_key = ${dateKey}
      FOR UPDATE;
    `;
    const nextSeq = (counters[0]?.last_seq || 0) + 1;
    await tx.$executeRaw`
      UPDATE document_counters SET last_seq = ${nextSeq}, updated_at = NOW()
      WHERE tenant_id = ${tenantId}::uuid AND doc_type = 'PO' AND date_key = ${dateKey};
    `;
    return `PO-${dateKey}-${String(nextSeq).padStart(4, "0")}`;
  }

  private async prepareOrderItems(
    tenantId: string,
    tx: Prisma.TransactionClient,
    items: CreatePurchaseOrderDto["items"],
  ) {
    let totalEstimatedMinor = 0n;
    const itemsData = [];

    for (const item of items) {
      const lineTotal =
        (BigInt(Math.round(item.qtyOrdered * 1000)) *
          BigInt(item.unitCostMinor)) /
        1000n;
      totalEstimatedMinor += lineTotal;

      let unitName = "pcs";
      let unitFactor = 1;
      if (item.productUnitId) {
        const unit = await tx.productUnit.findUnique({
          where: { id: item.productUnitId, tenantId },
        });
        if (!unit || !unit.isActive || !unit.isPurchaseUnit) {
          throw new BadRequestException("এককটি ক্রয়ের জন্য প্রযোজ্য বা সক্রিয় নয়।");
        }
        unitName = unit.name;
        unitFactor = Number(unit.factor);
      } else {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId, tenantId },
          include: { product: true },
        });
        if (variant?.product?.baseUnit) {
          unitName = variant.product.baseUnit;
        }
      }

      const baseQuantity = computeBaseQuantity(item.qtyOrdered, unitFactor);

      itemsData.push({
        id: uuidv7(),
        tenantId,
        variantId: item.variantId,
        productUnitId: item.productUnitId || null,
        unitName,
        unitFactor: new Prisma.Decimal(unitFactor),
        baseQuantity: new Prisma.Decimal(baseQuantity),
        qtyOrdered: new Prisma.Decimal(item.qtyOrdered),
        qtyReceived: new Prisma.Decimal(0),
        unitCostMinor: BigInt(item.unitCostMinor),
        totalMinor: lineTotal,
      });
    }

    return { totalEstimatedMinor, itemsData };
  }

  async create(
    tenantId: string,
    dto: CreatePurchaseOrderDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const poNumber =
        dto.poNumber || (await this.generatePoNumber(tenantId, tx));
      const { totalEstimatedMinor, itemsData } = await this.prepareOrderItems(
        tenantId,
        tx,
        dto.items,
      );

      const po = await tx.purchaseOrder.create({
        data: {
          tenantId,
          supplierId: dto.supplierId,
          branchId: dto.branchId,
          poNumber,
          status: "draft",
          totalEstimatedMinor,
          notes: dto.notes,
          expectedAt: dto.expectedAt,
          items: { create: itemsData },
        },
        include: { items: true },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "purchase_order.create",
          entityType: "purchase_order",
          entityId: po.id,
          after: {
            id: po.id,
            poNumber: po.poNumber,
            totalEstimatedMinor: Number(po.totalEstimatedMinor),
            itemsCount: po.items.length,
          },
          ip,
        },
        tx,
      );

      return po;
    });
  }

  private validateStatusTransition(currentStatus: string): void {
    if (currentStatus === "cancelled" || currentStatus === "received") {
      throw new BadRequestException(
        `Cannot change status of a ${currentStatus} purchase order`,
      );
    }
  }

  async updateStatus(
    tenantId: string,
    id: string,
    newStatus: string,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!po || po.tenantId !== tenantId) {
        throw new NotFoundException("Purchase order not found");
      }

      this.validateStatusTransition(po.status);

      const updateData: Prisma.PurchaseOrderUpdateInput = {
        status: newStatus,
      };
      if (newStatus === "ordered" && !po.orderedAt) {
        updateData.orderedAt = new Date();
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: updateData,
        include: { items: true },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "purchase_order.status_change",
          entityType: "purchase_order",
          entityId: id,
          before: { status: po.status },
          after: { status: updated.status },
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id },
        include: {
          supplier: true,
          branch: true,
          items: {
            include: {
              variant: {
                select: {
                  id: true,
                  sku: true,
                  costMinor: true,
                  priceMinor: true,
                  product: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      });
      if (!po || po.tenantId !== tenantId) {
        throw new NotFoundException("Purchase order not found");
      }
      return po;
    });
  }

  async findMany(
    tenantId: string,
    query: {
      supplierId?: string;
      branchId?: string;
      status?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.PurchaseOrderWhereInput = { tenantId };
      if (query.supplierId) where.supplierId = query.supplierId;
      if (query.branchId) where.branchId = query.branchId;
      if (query.status) where.status = query.status;
      if (query.search) {
        where.poNumber = { contains: query.search, mode: "insensitive" };
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = [
        "poNumber",
        "createdAt",
        "orderedAt",
        "expectedAt",
        "totalEstimatedMinor",
      ];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, items] = await Promise.all([
        tx.purchaseOrder.count({ where }),
        tx.purchaseOrder.findMany({
          where,
          skip,
          take: limit,
          include: {
            supplier: { select: { id: true, name: true } },
            items: true,
          },
          orderBy: { [sortBy]: sortOrder },
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
