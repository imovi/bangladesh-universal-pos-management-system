import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreatePurchaseOrderDto } from "@universal-pos/shared";

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private prepareOrderItems(
    tenantId: string,
    items: CreatePurchaseOrderDto["items"],
  ) {
    let totalEstimatedMinor = 0n;
    const itemsData = items.map((item) => {
      const lineTotal =
        (BigInt(Math.round(item.qtyOrdered * 1000)) *
          BigInt(item.unitCostMinor)) /
        1000n;
      totalEstimatedMinor += lineTotal;
      return {
        id: uuidv7(),
        tenantId,
        variantId: item.variantId,
        qtyOrdered: new Prisma.Decimal(item.qtyOrdered),
        qtyReceived: new Prisma.Decimal(0),
        unitCostMinor: BigInt(item.unitCostMinor),
        totalMinor: lineTotal,
      };
    });
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
        dto.poNumber || `PO-${Date.now().toString().slice(-6)}`;
      const { totalEstimatedMinor, itemsData } = this.prepareOrderItems(
        tenantId,
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
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.PurchaseOrderWhereInput = { tenantId };
      if (query.supplierId) where.supplierId = query.supplierId;
      if (query.branchId) where.branchId = query.branchId;
      if (query.status) where.status = query.status;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

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
          orderBy: { createdAt: "desc" },
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
