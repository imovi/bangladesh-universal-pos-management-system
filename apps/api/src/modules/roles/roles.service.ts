import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { CreateRoleDto, UpdateRoleDto } from "@universal-pos/shared";

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async findMany(tenantId: string) {
    return this.prisma.role.findMany({
      where: { tenantId },
      include: {
        rolePermissions: true,
      },
      orderBy: { name: "asc" },
    });
  }

  async findById(tenantId: string, id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, tenantId },
      include: {
        rolePermissions: true,
      },
    });

    if (!role) {
      throw new NotFoundException("Role not found");
    }

    return role;
  }

  async create(tenantId: string, dto: CreateRoleDto, actorUserId?: string) {
    const existing = await this.prisma.role.findUnique({
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

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          tenantId,
          name: dto.name,
          isSystem: false,
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
    const role = await this.findById(tenantId, id);

    return this.prisma.$transaction(async (tx) => {
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

        await tx.role.update({
          where: { id },
          data: { name: dto.name },
        });
      }

      if (dto.permissionKeys) {
        // Re-assign permissions
        await tx.rolePermission.deleteMany({
          where: { roleId: id },
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

      return this.findById(tenantId, id);
    });
  }

  async delete(tenantId: string, id: string, actorUserId?: string) {
    const role = await this.findById(tenantId, id);

    if (role.isSystem) {
      throw new ForbiddenException("System roles cannot be deleted");
    }

    await this.prisma.role.delete({
      where: { id },
    });

    await this.auditService.log({
      tenantId,
      actorUserId,
      action: "role.delete",
      entityType: "Role",
      entityId: id,
      before: { name: role.name },
    });

    return { deleted: true };
  }
}
