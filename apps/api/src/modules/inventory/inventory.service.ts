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
    allowNegativeOverride = false,
  ): Promise<void> {
    if (allowNegativeOverride) return;
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
      await tx.$executeRaw`
        INSERT INTO stock_levels (id, tenant_id, branch_id, variant_id, qty, updated_at)
        VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${item.branchId}::uuid, ${item.variantId}::uuid, 0, NOW())
        ON CONFLICT (tenant_id, branch_id, variant_id) DO NOTHING;
      `;
      const levels = await tx.$queryRaw<{ qty: string | number }[]>`
        SELECT qty FROM stock_levels
        WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${item.branchId}::uuid AND variant_id = ${item.variantId}::uuid
        FOR UPDATE;
      `;
      const currentQty = levels.length > 0 ? Number(levels[0].qty) : 0;
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
    options?: { allowNegativeOverride?: boolean },
  ): Promise<{ negativeStockItems: Array<{ branchId: string; variantId: string; newQty: number }> }> {
    if (!movements || movements.length === 0) return { negativeStockItems: [] };

    await this.assertStockAvailability(tenantId, tx, movements, options?.allowNegativeOverride);

    for (const m of movements) {
      await this.recordMovement(tenantId, tx, m);
    }

    const negativeStockItems: Array<{ branchId: string; variantId: string; newQty: number }> = [];
    const checked = new Set<string>();
    for (const m of movements) {
      if (m.qtyDelta < 0) {
        const key = `${m.branchId}:${m.variantId}`;
        if (!checked.has(key)) {
          checked.add(key);
          const level = await tx.stockLevel.findUnique({
            where: {
              tenantId_branchId_variantId: {
                tenantId,
                branchId: m.branchId,
                variantId: m.variantId,
              },
            },
          });
          if (level && Number(level.qty) < 0) {
            negativeStockItems.push({
              branchId: m.branchId,
              variantId: m.variantId,
              newQty: Number(level.qty),
            });
          }
        }
      }
    }

    return { negativeStockItems };
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
      search?: string;
      lowStock?: boolean;
      negative?: boolean;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.StockLevelWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;
      if (query.variantId) where.variantId = query.variantId;
      if (query.negative) {
        where.qty = { lt: new Prisma.Decimal(0) };
      }
      if (query.search) {
        where.OR = [
          { variant: { sku: { contains: query.search, mode: "insensitive" } } },
          { variant: { product: { name: { contains: query.search, mode: "insensitive" } } } },
        ];
      }

      const allLevels = await tx.stockLevel.findMany({
        where,
        include: {
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          variant: {
            select: {
              id: true,
              sku: true,
              costMinor: true,
              priceMinor: true,
              reorderLevel: true,
              barcodes: true,
              optionValues: {
                include: {
                  optionValue: {
                    include: {
                      option: true,
                    },
                  },
                },
              },
              product: {
                select: {
                  id: true,
                  name: true,
                  category: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { updatedAt: "desc" },
      });

      let filtered = allLevels;
      if (query.lowStock) {
        filtered = allLevels.filter(
          (l) =>
            l.variant.reorderLevel !== null &&
            Number(l.qty) <= Number(l.variant.reorderLevel),
        );
      }

      const allowedSortFields = ["qty", "updatedAt"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "updatedAt";
      const sortAsc = query.sortOrder === "asc";

      if (sortBy === "qty") {
        filtered.sort((a, b) =>
          sortAsc ? Number(a.qty) - Number(b.qty) : Number(b.qty) - Number(a.qty),
        );
      } else {
        filtered.sort((a, b) =>
          sortAsc
            ? a.updatedAt.getTime() - b.updatedAt.getTime()
            : b.updatedAt.getTime() - a.updatedAt.getTime(),
        );
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      let inTransitMap: Record<string, number> = {};
      if (query.branchId) {
        const sentTransfers = await tx.stockTransfer.findMany({
          where: {
            tenantId,
            destinationBranchId: query.branchId,
            status: "sent",
          },
          include: {
            items: true,
          },
        });
        for (const t of sentTransfers) {
          for (const it of t.items) {
            inTransitMap[it.variantId] = (inTransitMap[it.variantId] || 0) + Number(it.sentQty);
          }
        }
      }

      const items = filtered.slice(skip, skip + limit).map((l) => ({
        ...l,
        inTransitQty: inTransitMap[l.variantId] || 0,
        reorderLevel: l.variant.reorderLevel !== null ? Number(l.variant.reorderLevel) : null,
      }));

      return {
        items,
        pagination: {
          total: filtered.length,
          page,
          limit,
          totalPages: Math.ceil(filtered.length / limit),
        },
      };
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
