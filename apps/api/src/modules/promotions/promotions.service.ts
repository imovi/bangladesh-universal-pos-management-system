import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreatePromotionInput,
  UpdatePromotionInput,
  PromotionQueryInput,
  PreviewPromotionInput,
  evaluatePromotions,
  PromotionRule,
} from "@universal-pos/shared";

@Injectable()
export class PromotionsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async findAll(tenantId: string, query: PromotionQueryInput) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: any = { tenantId };

      if (query.status) {
        where.status = query.status;
      }
      if (query.type) {
        where.type = query.type;
      }
      if (query.search) {
        where.name = { contains: query.search, mode: "insensitive" };
      }

      const page = query.page || 1;
      const limit = query.limit || 50;
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.promotion.count({ where }),
        tx.promotion.findMany({
          where,
          orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
          skip,
          take: limit,
        }),
      ]);

      return {
        data: items,
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const promo = await tx.promotion.findFirst({
        where: { id, tenantId },
      });
      if (!promo) {
        throw new NotFoundException({
          code: "PROMOTION_NOT_FOUND",
          message: "Promotion not found",
        });
      }
      return promo;
    });
  }

  async create(
    tenantId: string,
    userId: string,
    input: CreatePromotionInput,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const created = await tx.promotion.create({
        data: {
          tenantId,
          name: input.name,
          description: input.description,
          type: input.type,
          status: input.status || "active",
          priority: input.priority ?? 0,
          stackableWithBill: input.stackableWithBill ?? true,
          startDate: input.startDate ? new Date(input.startDate) : null,
          endDate: input.endDate ? new Date(input.endDate) : null,
          config: (input.config || {}) as any,
          targets: (input.targets || {}) as any,
          conditions: (input.conditions || {}) as any,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "PROMOTION_CREATED",
        entityType: "promotion",
        entityId: created.id,
        after: created as any,
        ip,
      }, tx);

      return created;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    input: UpdatePromotionInput,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.promotion.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: "PROMOTION_NOT_FOUND",
          message: "Promotion not found",
        });
      }

      const updated = await tx.promotion.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.stackableWithBill !== undefined ? { stackableWithBill: input.stackableWithBill } : {}),
          ...(input.startDate !== undefined
            ? { startDate: input.startDate ? new Date(input.startDate) : null }
            : {}),
          ...(input.endDate !== undefined
            ? { endDate: input.endDate ? new Date(input.endDate) : null }
            : {}),
          ...(input.config !== undefined ? { config: input.config as any } : {}),
          ...(input.targets !== undefined ? { targets: input.targets as any } : {}),
          ...(input.conditions !== undefined ? { conditions: input.conditions as any } : {}),
        },
      });

      // "Editing a promotion that has already been used creates a change entry in the audit log with the old and new values."
      if (existing.totalUses > 0) {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "PROMOTION_UPDATED_AFTER_USE",
          entityType: "promotion",
          entityId: id,
          before: existing as any,
          after: updated as any,
          ip,
        }, tx);
      } else {
        await this.auditService.log({
          tenantId,
          actorUserId: userId,
          action: "PROMOTION_UPDATED",
          entityType: "promotion",
          entityId: id,
          before: existing as any,
          after: updated as any,
          ip,
        }, tx);
      }

      return updated;
    });
  }

  async pause(tenantId: string, userId: string, id: string, ip?: string) {
    return this.update(tenantId, userId, id, { status: "paused" }, ip);
  }

  async resume(tenantId: string, userId: string, id: string, ip?: string) {
    return this.update(tenantId, userId, id, { status: "active" }, ip);
  }

  async end(tenantId: string, userId: string, id: string, ip?: string) {
    return this.update(tenantId, userId, id, { status: "ended" }, ip);
  }

  async duplicate(tenantId: string, userId: string, id: string, ip?: string) {
    const existing = await this.findById(tenantId, id);
    return this.create(
      tenantId,
      userId,
      {
        name: `${existing.name} (Copy)`,
        description: existing.description,
        type: existing.type as any,
        status: "draft",
        priority: existing.priority,
        stackableWithBill: existing.stackableWithBill,
        startDate: existing.startDate,
        endDate: existing.endDate,
        config: existing.config as any,
        targets: existing.targets as any,
        conditions: existing.conditions as any,
      },
      ip,
    );
  }

  async delete(tenantId: string, userId: string, id: string, ip?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.promotion.findFirst({
        where: { id, tenantId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: "PROMOTION_NOT_FOUND",
          message: "Promotion not found",
        });
      }

      // "An ended or used promotion cannot be deleted, only ended."
      if (existing.status === "ended" || existing.totalUses > 0) {
        throw new BadRequestException({
          code: "PROMOTION_CANNOT_BE_DELETED",
          message: "Used or ended promotions cannot be deleted, only ended",
        });
      }

      await tx.promotion.delete({ where: { id } });

      await this.auditService.log({
        tenantId,
        actorUserId: userId,
        action: "PROMOTION_DELETED",
        entityType: "promotion",
        entityId: id,
        before: existing as any,
        ip,
      }, tx);

      return { success: true, message: "Promotion deleted" };
    });
  }

  preview(input: PreviewPromotionInput) {
    const promoRule: PromotionRule = {
      id: input.promotion.id || "preview-promo",
      name: input.promotion.name,
      type: input.promotion.type,
      status: input.promotion.status || "active",
      priority: input.promotion.priority ?? 0,
      stackableWithBill: input.promotion.stackableWithBill ?? true,
      membersOnly: Boolean((input.promotion.conditions as any)?.membersOnly),
      branchIds: (input.promotion.conditions as any)?.branchIds,
      minQuantity: (input.promotion.conditions as any)?.minQuantity,
      startAt: input.promotion.startDate ? new Date(input.promotion.startDate) : new Date("2020-01-01"),
      endAt: input.promotion.endDate ? new Date(input.promotion.endDate) : new Date("2030-01-01"),
      daysOfWeek: (input.promotion.conditions as any)?.daysOfWeek,
      hours: (input.promotion.conditions as any)?.hours,
      targetType: ((input.promotion.targets as any)?.targetType || "ALL") as any,
      targetIds: (input.promotion.targets as any)?.targetIds,
      exclusionIds: (input.promotion.targets as any)?.exclusionIds,
      config: (input.promotion.config || {}) as any,
    };

    return evaluatePromotions({
      lines: input.lines as any,
      promotions: [promoRule],
      couponCode: input.couponCode,
      branchId: input.branchId,
      customerId: input.customerId,
      evaluationTime: input.evaluationTime,
    });
  }
}
