import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditService } from "../audit/audit.service.js";
import argon2 from "argon2";
import { CreateUserDto, UpdateUserDto } from "@universal-pos/shared";

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly auditService: AuditService,
  ) {}

  async findMany(tenantId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const [items, total] = await Promise.all([
        tx.user.findMany({
          where: { tenantId },
          select: {
            id: true,
            email: true,
            phone: true,
            name: true,
            isActive: true,
            lastLoginAt: true,
            createdAt: true,
            userRoles: {
              include: {
                role: true,
              },
            },
            userBranches: {
              include: {
                branch: true,
              },
            },
          },
          skip,
          take: limit,
          orderBy: { createdAt: "desc" },
        }),
        tx.user.count({ where: { tenantId } }),
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
      const user = await tx.user.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: {
            include: {
              role: true,
            },
          },
          userBranches: {
            include: {
              branch: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundException("User not found");
      }

      return user;
    });
  }

  async create(tenantId: string, dto: CreateUserDto, actorUserId?: string) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.user.findUnique({
        where: {
          tenantId_email: {
            tenantId,
            email: dto.email,
          },
        },
      });

      if (existing) {
        throw new ConflictException(
          `User with email '${dto.email}' already exists in this tenant`,
        );
      }

      const passwordHash = await argon2.hash(dto.password);
      const pinHash = dto.pin ? await argon2.hash(dto.pin) : null;

      const user = await tx.user.create({
        data: {
          tenantId,
          name: dto.name,
          email: dto.email,
          phone: dto.phone || null,
          passwordHash,
          pinHash,
          isActive: true,
        },
      });

      // Role assignments
      await tx.userRole.createMany({
        data: dto.roleIds.map((roleId) => ({
          tenantId,
          userId: user.id,
          roleId,
        })),
      });

      // Branch assignments
      if (dto.branchIds && dto.branchIds.length > 0) {
        await tx.userBranch.createMany({
          data: dto.branchIds.map((branchId) => ({
            tenantId,
            userId: user.id,
            branchId,
          })),
        });
      }

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "user.create",
          entityType: "User",
          entityId: user.id,
          after: { email: user.email, name: user.name },
        },
        tx,
      );

      return tx.user.findFirst({
        where: { id: user.id, tenantId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: { include: { role: true } },
          userBranches: { include: { branch: true } },
        },
      });
    });
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateUserDto,
    actorUserId?: string,
  ) {
    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const current = await tx.user.findFirst({
        where: { id, tenantId },
      });

      if (!current) {
        throw new NotFoundException("User not found");
      }

      const updated = await tx.user.update({
        where: { id, tenantId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      if (dto.roleIds) {
        await tx.userRole.deleteMany({
          where: { userId: id, tenantId },
        });
        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            tenantId,
            userId: id,
            roleId,
          })),
        });
      }

      if (dto.branchIds) {
        await tx.userBranch.deleteMany({
          where: { userId: id, tenantId },
        });
        await tx.userBranch.createMany({
          data: dto.branchIds.map((branchId) => ({
            tenantId,
            userId: id,
            branchId,
          })),
        });
      }

      await this.auditService.log(
        {
          tenantId,
          actorUserId,
          action: "user.update",
          entityType: "User",
          entityId: id,
          before: { name: current.name, isActive: current.isActive },
          after: { name: updated.name, isActive: updated.isActive },
        },
        tx,
      );

      return tx.user.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
          userRoles: { include: { role: true } },
          userBranches: { include: { branch: true } },
        },
      });
    });
  }
}
