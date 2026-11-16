import { Injectable } from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { Prisma } from "@prisma/client";

export interface CreateAuditLogParams {
  tenantId: string;
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async log(
    a: CreateAuditLogParams | Prisma.TransactionClient,
    b?: Prisma.TransactionClient | CreateAuditLogParams,
  ) {
    let params: CreateAuditLogParams;
    let tx: Prisma.TransactionClient | undefined;

    if (a && "tenantId" in a) {
      params = a as CreateAuditLogParams;
      tx = b as Prisma.TransactionClient | undefined;
    } else {
      tx = a as Prisma.TransactionClient;
      params = b as CreateAuditLogParams;
    }

    const execute = (client: Prisma.TransactionClient) =>
      client.auditLog.create({
        data: {
          tenantId: params.tenantId,
          actorUserId: params.actorUserId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          before: params.before
            ? (params.before as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          after: params.after
            ? (params.after as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ip: params.ip,
        },
      });

    if (tx) {
      return execute(tx);
    }

    return this.tenantContext.runWithTenant(params.tenantId, async (ctxTx) => {
      return execute(ctxTx);
    });
  }

  async findMany(
    tenantId: string,
    query: {
      page?: number;
      limit?: number;
      entityType?: string;
      action?: string;
      actorUserId?: string;
      startDate?: string;
      endDate?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
    },
  ) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {
      tenantId,
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
    };

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    const allowedSortFields = ["createdAt", "action", "entityType"];
    const sortBy = allowedSortFields.includes(query.sortBy || "")
      ? (query.sortBy as string)
      : "createdAt";
    const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.auditLog.findMany({
          where,
          skip,
          take: limit,
          orderBy: { [sortBy]: sortOrder },
        }),
        tx.auditLog.count({ where }),
      ]);

      return {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    });
  }
}
