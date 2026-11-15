import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateSupplierDto, UpdateSupplierDto } from "@universal-pos/shared";

@Injectable()
export class SuppliersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateSupplierDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.create({
        data: {
          tenantId,
          name: dto.name,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email || null,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "supplier.create",
          entityType: "supplier",
          entityId: supplier.id,
          after: supplier as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return supplier;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateSupplierDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.supplier.findUnique({
        where: { id },
      });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Supplier not found");
      }

      const updated = await tx.supplier.update({
        where: { id },
        data: {
          name: dto.name,
          contactName: dto.contactName,
          phone: dto.phone,
          email: dto.email !== undefined ? dto.email || null : undefined,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "supplier.update",
          entityType: "supplier",
          entityId: id,
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id },
      });
      if (!supplier || supplier.tenantId !== tenantId) {
        throw new NotFoundException("Supplier not found");
      }
      return supplier;
    });
  }

  async findMany(
    tenantId: string,
    query: { search?: string; page?: number; limit?: number },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.SupplierWhereInput = { tenantId };
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
          { contactName: { contains: query.search, mode: "insensitive" } },
        ];
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const [total, items] = await Promise.all([
        tx.supplier.count({ where }),
        tx.supplier.findMany({
          where,
          skip,
          take: limit,
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
