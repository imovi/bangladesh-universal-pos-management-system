import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateRegisterDto, UpdateRegisterDto } from "@universal-pos/shared";

@Injectable()
export class RegistersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateRegisterDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.register.findUnique({
        where: {
          tenantId_branchId_code: {
            tenantId,
            branchId: dto.branchId,
            code: dto.code,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Register with code '${dto.code}' already exists in this branch`,
        );
      }

      const register = await tx.register.create({
        data: {
          tenantId,
          branchId: dto.branchId,
          name: dto.name,
          code: dto.code,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "register.create",
          entityType: "register",
          entityId: register.id,
          after: register as unknown as Record<string, unknown>,
          ip,
        },
        tx,
      );

      return register;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRegisterDto,
    userId?: string,
    ip?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.register.findUnique({
        where: { id },
      });
      if (!existing || existing.tenantId !== tenantId) {
        throw new NotFoundException("Register not found");
      }

      const updated = await tx.register.update({
        where: { id },
        data: {
          name: dto.name,
          code: dto.code,
          isActive: dto.isActive,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId: userId,
          action: "register.update",
          entityType: "register",
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
      const register = await tx.register.findUnique({
        where: { id },
        include: { branch: true },
      });
      if (!register || register.tenantId !== tenantId) {
        throw new NotFoundException("Register not found");
      }
      return register;
    });
  }

  async findMany(tenantId: string, query: { branchId?: string }) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const where: Prisma.RegisterWhereInput = { tenantId };
      if (query.branchId) where.branchId = query.branchId;

      return tx.register.findMany({
        where,
        orderBy: { code: "asc" },
      });
    });
  }
}
