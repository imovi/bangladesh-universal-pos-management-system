import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateBranchDto, UpdateBranchDto } from "@universal-pos/shared";

@Injectable()
export class BranchesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async findMany(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.branch.findMany({
          where: { tenantId },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        tx.branch.count({ where: { tenantId } }),
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

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const branch = await tx.branch.findFirst({
        where: { id, tenantId },
      });
      if (!branch) {
        throw new NotFoundException("Branch not found");
      }
      return branch;
    });
  }

  async create(tenantId: string, dto: CreateBranchDto, actorUserId?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.branch.findUnique({
        where: {
          tenantId_code: {
            tenantId,
            code: dto.code,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Branch with code '${dto.code}' already exists`,
        );
      }

      const branch = await tx.branch.create({
        data: {
          tenantId,
          name: dto.name,
          code: dto.code,
          address: dto.address || null,
          isActive: true,
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "branch.create",
          entityType: "Branch",
          entityId: branch.id,
          after: { name: branch.name, code: branch.code },
        },
        tx,
      );

      return branch;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateBranchDto,
    actorUserId?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const current = await tx.branch.findFirst({
        where: { id, tenantId },
      });
      if (!current) {
        throw new NotFoundException("Branch not found");
      }

      if (dto.code && dto.code !== current.code) {
        const existing = await tx.branch.findUnique({
          where: {
            tenantId_code: {
              tenantId,
              code: dto.code,
            },
          },
        });
        if (existing) {
          throw new ConflictException(
            `Branch with code '${dto.code}' already exists`,
          );
        }
      }

      const updated = await tx.branch.update({
        where: { id, tenantId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.code ? { code: dto.code } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "branch.update",
          entityType: "Branch",
          entityId: id,
          before: {
            name: current.name,
            code: current.code,
            isActive: current.isActive,
          },
          after: {
            name: updated.name,
            code: updated.code,
            isActive: updated.isActive,
          },
        },
        tx,
      );

      return updated;
    });
  }
}
