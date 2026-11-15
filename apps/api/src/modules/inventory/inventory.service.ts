import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { v7 as uuidv7 } from "uuid";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  BulkOpeningStockDto,
  StockAdjustmentDto,
} from "@universal-pos/shared";

export interface ApplyMovementInput {
  id?: string;
  branchId: string;
  variantId: string;
  qtyDelta: number;
  type: string;
  unitCostMinor?: number | bigint;
  refType?: string;
  refId?: string;
  reason?: string;
  actorUserId?: string;
  occurredAt?: Date;
}

@Injectable()
export class InventoryService {
  private settingsCache = new Map<
    string,
    { allowNegative: boolean; timestamp: number }
  >();

  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly systemDb: SystemDbService,
    private readonly auditService: AuditService,
  ) {}

  clearSettingsCache(tenantId?: string) {
    if (tenantId) this.settingsCache.delete(tenantId);
    else this.settingsCache.clear();
  }

  private async isNegativeStockAllowed(tenantId: string): Promise<boolean> {
    const entry = this.settingsCache.get(tenantId);
    if (entry && Date.now() - entry.timestamp < 1000) {
      return entry.allowNegative;
    }
    const tenant = await this.systemDb.findTenantById(tenantId);
    const settings = (tenant?.settings as Record<string, any>) || {};
    const allowNegative = settings.allow_negative_stock ?? true;
    this.settingsCache.set(tenantId, { allowNegative, timestamp: Date.now() });
    return allowNegative;
  }

  private async assertStockAvailability(
    tenantId: string,
    tx: Prisma.TransactionClient,
    movements: ApplyMovementInput[],
  ): Promise<void> {
    const hasNegative = movements.some((m) => m.qtyDelta < 0);
    if (!hasNegative) return;

    const allowNegative = await this.isNegativeStockAllowed(tenantId);
    if (allowNegative) return;

    // Aggregate negative deltas by branchId:variantId
    const deltasByItem = new Map<
      string,
      { branchId: string; variantId: string; totalNegativeDelta: number }
    >();
    for (const m of movements) {
      if (m.qtyDelta < 0) {
        const key = `${m.branchId}:${m.variantId}`;
        const existing = deltasByItem.get(key) || {
          branchId: m.branchId,
          variantId: m.variantId,
          totalNegativeDelta: 0,
        };
        existing.totalNegativeDelta += m.qtyDelta;
        deltasByItem.set(key, existing);
      }
    }

    for (const item of deltasByItem.values()) {
      const level = await tx.stockLevel.findUnique({
        where: {
          tenantId_branchId_variantId: {
            tenantId,
            branchId: item.branchId,
            variantId: item.variantId,
          },
        },
      });
      const currentQty = level ? Number(level.qty) : 0;
      if (currentQty + item.totalNegativeDelta < 0) {
        throw new BadRequestException(
          `Insufficient stock for variant ${item.variantId}`,
        );
      }
    }
  }

  private async recordMovement(
    tenantId: string,
    tx: Prisma.TransactionClient,
    m: ApplyMovementInput,
  ): Promise<void> {
    const id = m.id || uuidv7();
    await tx.stockMovement.create({
      data: {
        id,
        tenantId,
        branchId: m.branchId,
        variantId: m.variantId,
        qtyDelta: new Prisma.Decimal(m.qtyDelta),
        type: m.type,
        unitCostMinor: m.unitCostMinor ? BigInt(m.unitCostMinor) : BigInt(0),
        refType: m.refType,
        refId: m.refId,
        reason: m.reason,
        actorUserId: m.actorUserId,
        occurredAt: m.occurredAt || new Date(),
      },
    });

    const randomId = uuidv7();
    await tx.$executeRaw`
      INSERT INTO stock_levels (id, tenant_id, branch_id, variant_id, qty, updated_at)
      VALUES (
        ${randomId}::uuid,
        ${tenantId}::uuid,
        ${m.branchId}::uuid,
        ${m.variantId}::uuid,
        ${m.qtyDelta}::numeric,
        NOW()
      )
      ON CONFLICT (tenant_id, branch_id, variant_id)
      DO UPDATE SET
        qty = stock_levels.qty + EXCLUDED.qty,
        updated_at = NOW();
    `;
  }

  async applyMovements(
    tenantId: string,
    tx: Prisma.TransactionClient,
    movements: ApplyMovementInput[],
  ): Promise<void> {
    if (!movements || movements.length === 0) return;

    await this.assertStockAvailability(tenantId, tx, movements);

    for (const m of movements) {
      await this.recordMovement(tenantId, tx, m);
    }
  }

  async createOpeningStock(
    tenantId: string,
    dto: BulkOpeningStockDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const movements: ApplyMovementInput[] = dto.items.map((item) => ({
        branchId: dto.branchId,
        variantId: item.variantId,
        qtyDelta: item.quantity,
        type: "opening",
        reason: "Opening stock",
        unitCostMinor: item.unitCostMinor,
        actorUserId: userId,
      }));

      await this.applyMovements(tenantId, tx, movements);

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "inventory.opening_stock",
          entityType: "inventory",
          entityId: dto.branchId,
          after: { branchId: dto.branchId, itemsCount: dto.items.length },
          ip,
        },
        tx,
      );

      return { success: true, count: dto.items.length };
    });
  }

  private async logStockAdjustment(
    tenantId: string,
    tx: Prisma.TransactionClient,
    dto: StockAdjustmentDto,
    previousQty: number,
    newQty: number,
    userId?: string,
    ip?: string,
  ): Promise<void> {
    await this.auditService.log(
      {
        tenantId,
        actorUserId: userId,
        action: "stock.adjust",
        entityType: "stock_level",
        entityId: `${dto.branchId}:${dto.variantId}`,
        before: { qty: previousQty },
        after: {
          qty: newQty,
          delta: dto.qtyDelta,
          reason: dto.reason,
          variantId: dto.variantId,
          branchId: dto.branchId,
        },
        ip,
      },
      tx,
    );
  }

  async adjustStock(
    tenantId: string,
    dto: StockAdjustmentDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const prev = await tx.stockLevel.findUnique({
        where: {
          tenantId_branchId_variantId: {
            tenantId,
            branchId: dto.branchId,
            variantId: dto.variantId,
          },
        },
      });

      const previousQty = prev ? Number(prev.qty) : 0;

      await this.applyMovements(tenantId, tx, [
        {
          branchId: dto.branchId,
          variantId: dto.variantId,
          qtyDelta: dto.qtyDelta,
          type: "adjustment",
          reason: dto.reason,
          actorUserId: userId,
        },
      ]);

      const updated = await tx.stockLevel.findUnique({
        where: {
          tenantId_branchId_variantId: {
            tenantId,
            branchId: dto.branchId,
            variantId: dto.variantId,
          },
        },
      });

      const newQty = updated ? Number(updated.qty) : previousQty + dto.qtyDelta;

      await this.logStockAdjustment(
        tenantId,
        tx,
        dto,
        previousQty,
        newQty,
        userId,
        ip,
      );

      return {
        branchId: dto.branchId,
        variantId: dto.variantId,
        previousQty,
        newQty,
        delta: dto.qtyDelta,
        reason: dto.reason,
      };
    });
  }

  async getStockLevels(
    tenantId: string,
    query: {
      branchId?: string;
      variantId?: string;
      lowStock?: boolean;
      negative?: boolean;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.StockLevelWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;
      if (query.variantId) where.variantId = query.variantId;
      if (query.negative) {
        where.qty = { lt: new Prisma.Decimal(0) };
      }

      const levels = await tx.stockLevel.findMany({
        where,
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              costMinor: true,
              priceMinor: true,
              reorderLevel: true,
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      if (query.lowStock) {
        return levels.filter(
          (l) =>
            l.variant.reorderLevel !== null &&
            Number(l.qty) <= Number(l.variant.reorderLevel),
        );
      }

      return levels;
    });
  }

  async getMovements(
    tenantId: string,
    query: {
      branchId?: string;
      variantId?: string;
      type?: string;
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.StockMovementWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;
      if (query.variantId) where.variantId = query.variantId;
      if (query.type) where.type = query.type;

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.stockMovement.count({ where }),
        tx.stockMovement.findMany({
          where,
          skip,
          take: limit,
          orderBy: { occurredAt: "desc" },
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
