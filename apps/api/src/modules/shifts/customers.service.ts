import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import {
  CreateCustomerDto,
  UpdateCustomerDto,
  normalizePhone,
} from "@universal-pos/shared";

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  private async checkPhoneConflict(
    tx: Prisma.TransactionClient,
    tenantId: string,
    phone: string,
  ) {
    const existing = await tx.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });
    if (existing) {
      throw new ConflictException(`Customer with phone ${phone} already exists`);
    }
  }

  async create(
    tenantId: string,
    dto: CreateCustomerDto,
    userId?: string,
    ip?: string,
  ) {
    const normalizedPhone = normalizePhone(dto.phone);

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      await this.checkPhoneConflict(tx, tenantId, normalizedPhone);

      const customer = await tx.customer.create({
        data: {
          tenantId,
          name: dto.name,
          phone: normalizedPhone,
          email: dto.email || null,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.create",
          entityType: "customer",
          entityId: customer.id,
          after: customer as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return customer;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateCustomerDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.customer.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Customer not found");
      }

      let phone = existing.phone;
      if (dto.phone) {
        const normalized = normalizePhone(dto.phone);
        if (normalized !== existing.phone) {
          await this.checkPhoneConflict(tx, tenantId, normalized);
          phone = normalized;
        }
      }

      const updated = await tx.customer.update({
        where: { id },
        data: {
          name: dto.name,
          phone,
          email: dto.email !== undefined ? dto.email || null : undefined,
          address: dto.address,
          notes: dto.notes,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "customer.update",
          entityType: "customer",
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
      const customer = await tx.customer.findUnique({
        where: { id },
      });
      if (!customer || customer.tenantId !== tenantId) {
        throw new NotFoundException("Customer not found");
      }
      return customer;
    });
  }

  async findMany(
    tenantId: string,
    query: {
      search?: string;
      sortBy?: string;
      sortOrder?: "asc" | "desc";
      page?: number;
      limit?: number;
    },
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.CustomerWhereInput = { tenantId };
      if (query.search) {
        where.OR = [
          { name: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
        ];
      }

      const page = Math.max(1, query.page || 1);
      const limit = Math.min(100, Math.max(1, query.limit || 50));
      const skip = (page - 1) * limit;

      const allowedSortFields = ["name", "createdAt", "totalSpentMinor", "totalVisits"];
      const sortBy = allowedSortFields.includes(query.sortBy || "")
        ? (query.sortBy as string)
        : "createdAt";
      const sortOrder: Prisma.SortOrder = query.sortOrder === "asc" ? "asc" : "desc";

      const [total, items] = await Promise.all([
        tx.customer.count({ where }),
        tx.customer.findMany({
          where,
          skip,
          take: limit,
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
