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

  private async processReceiptItems(
    tenantId: string,
    tx: Prisma.TransactionClient,
    branchId: string,
    items: CreateGoodsReceiptDto["items"],
  ): Promise<void> {
    for (const item of items) {
      await this.updateWeightedAverageCost(
        tenantId,
        tx,
        branchId,
        item.variantId,
        item.qtyReceived,
        item.unitCostMinor,
      );

      if (item.purchaseOrderItemId) {
        await tx.purchaseOrderItem.update({
          where: { id: item.purchaseOrderItemId },
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
    userId?: string,
  ) {
    return tx.goodsReceipt.create({
      data: {
        id: grnId,
        tenantId,
        grnNumber,
        purchaseOrderId: dto.purchaseOrderId,
        branchId: dto.branchId,
        receivedByUserId: userId,
        notes: dto.notes,
        items: {
          create: dto.items.map((item) => ({
            id: uuidv7(),
            tenantId,
            purchaseOrderItemId: item.purchaseOrderItemId,
            variantId: item.variantId,
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

      await this.processReceiptItems(tenantId, tx, dto.branchId, dto.items);
      const goodsReceipt = await this.insertGoodsReceipt(
        tenantId,
        tx,
        grnId,
        grnNumber,
        dto,
        userId,
      );

      await this.inventoryService.applyMovements(
        tenantId,
        tx,
        dto.items.map((item) => ({
          branchId: dto.branchId,
          variantId: item.variantId,
          qtyDelta: item.qtyReceived,
          type: "purchase",
          unitCostMinor: item.unitCostMinor,
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
}
