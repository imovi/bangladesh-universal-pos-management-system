import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateRoleDto, UpdateRoleDto } from "@universal-pos/shared";

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async findMany(tenantId: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.role.findMany({
        where: { tenantId },
        include: {
          rolePermissions: true,
        },
        orderBy: { name: "asc" },
      });
    });
  }

  async findById(tenantId: string, id: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId },
        include: {
          rolePermissions: true,
        },
      });

      if (!role) {
        throw new NotFoundException("Role not found");
      }

      return role;
    });
  }

  async create(tenantId: string, dto: CreateRoleDto, actorUserId?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.role.findUnique({
        where: {
          tenantId_name: {
            tenantId,
            name: dto.name,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `Role '${dto.name}' already exists in this tenant`,
        );
      }

      const role = await tx.role.create({
        data: {
          tenantId,
          name: dto.name,
          isSystem: false,
          maxDiscountPercent: dto.maxDiscountPercent ?? null,
        },
      });

      if (dto.permissionKeys && dto.permissionKeys.length > 0) {
        await tx.rolePermission.createMany({
          data: dto.permissionKeys.map((key) => ({
            tenantId,
            roleId: role.id,
            permissionKey: key,
          })),
        });
      }

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "role.create",
          entityType: "Role",
          entityId: role.id,
          after: { name: role.name, permissions: dto.permissionKeys },
        },
        tx,
      );

      return role;
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateRoleDto,
    actorUserId?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId },
      });

      if (!role) {
        throw new NotFoundException("Role not found");
      }

      if (dto.name && dto.name !== role.name) {
        if (role.isSystem) {
          throw new ForbiddenException("System roles cannot be renamed");
        }

        const existing = await tx.role.findUnique({
          where: {
            tenantId_name: {
              tenantId,
              name: dto.name,
            },
          },
        });

        if (existing) {
          throw new ConflictException(`Role '${dto.name}' already exists`);
        }
      }

      const updateData: { name?: string; maxDiscountPercent?: number | null } = {};
      if (dto.name && dto.name !== role.name) {
        updateData.name = dto.name;
      }
      if (dto.maxDiscountPercent !== undefined) {
        updateData.maxDiscountPercent = dto.maxDiscountPercent;
      }
      if (Object.keys(updateData).length > 0) {
        await tx.role.update({
          where: { id, tenantId },
          data: updateData,
        });
      }

      if (dto.permissionKeys) {
        await tx.rolePermission.deleteMany({
          where: { roleId: id, tenantId },
        });

        await tx.rolePermission.createMany({
          data: dto.permissionKeys.map((key) => ({
            tenantId,
            roleId: id,
            permissionKey: key,
          })),
        });
      }

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "role.update",
          entityType: "Role",
          entityId: id,
          after: { name: dto.name, permissions: dto.permissionKeys },
        },
        tx,
      );

      return tx.role.findFirst({
        where: { id, tenantId },
        include: { rolePermissions: true },
      });
    });
  }

  async delete(tenantId: string, id: string, actorUserId?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const role = await tx.role.findFirst({
        where: { id, tenantId },
      });

      if (!role) {
        throw new NotFoundException("Role not found");
      }

      if (role.isSystem) {
        throw new ForbiddenException("System roles cannot be deleted");
      }

      await tx.role.delete({
        where: { id, tenantId },
      });

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "role.delete",
          entityType: "Role",
          entityId: id,
          before: { name: role.name },
        },
        tx,
      );

      return { deleted: true };
    });
  }
}
