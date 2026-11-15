import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { Prisma } from '@prisma/client';

export interface CreateTenantSignupData {
  companyName: string;
  slug: string;
  businessType: string;
  settings?: Record<string, unknown>;
  branch: {
    name: string;
    code: string;
    address?: string | null;
  };
  roles: Array<{
    name: string;
    isSystem: boolean;
    permissions: string[];
    maxDiscountPercent?: number | null;
  }>;
  owner: {
    name: string;
    email: string;
    phone?: string | null;
    passwordHash: string;
    pinHash?: string | null;
  };
  ip?: string;
}

@Injectable()
export class SystemDbService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Finds a tenant by its unique slug (used for public login flow).
   */
  async findTenantBySlug(slug: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.tenant.findUnique({
        where: { slug },
      });
    });
  }

  /**
   * Finds a tenant by its primary key ID.
   */
  async findTenantById(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.tenant.findUnique({
        where: { id },
      });
    });
  }

  /**
   * Updates tenant settings via pos_app role under tenant context.
   */
  async updateTenantSettings(id: string, settings: Record<string, unknown>) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_app;`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${id}, true);`;
      const current = await tx.tenant.findUnique({
        where: { id },
        select: { id: true, name: true, slug: true, settings: true },
      });
      const currentSettings = (current?.settings as Record<string, unknown>) || {};
      return tx.tenant.update({
        where: { id },
        data: {
          settings: { ...currentSettings, ...settings } as Prisma.InputJsonValue,
        },
        select: { id: true, name: true, slug: true, settings: true },
      });
    });
  }

  /**
   * Looks up a refresh token by its SHA-256 hash without tenant context
   * (since client presents only the opaque token string).
   */
  async findRefreshTokenByHash(tokenHash: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.refreshToken.findFirst({
        where: { tokenHash },
      });
    });
  }

  /**
   * Revokes all refresh tokens belonging to a user (used during compromised token reuse).
   */
  async revokeAllUserRefreshTokens(userId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.refreshToken.updateMany({
        where: { userId },
        data: { revokedAt: new Date() },
      });
    });
  }

  /**
   * Atomically provisions a new Tenant, initial Branch, System Roles & Permissions,
   * Owner User, User Roles, User Branches, and Audit Log.
   * If any step fails, the entire transaction rolls back cleanly.
   */
  async createTenantWithInitialData(data: CreateTenantSignupData) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      // 1. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: data.companyName,
          slug: data.slug,
          businessType: data.businessType,
          status: 'active',
          settings: (data.settings as Prisma.InputJsonValue) || {
            currency: 'BDT',
            language: 'bn',
            taxRate: 5,
          },
        },
      });

      // 2. Create primary Branch
      const branch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          name: data.branch.name,
          code: data.branch.code,
          address: data.branch.address || null,
          isActive: true,
        },
      });

      // 3. Seed System Roles and their permissions
      let ownerRoleId: string | undefined;

      for (const roleDef of data.roles) {
        const createdRole = await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: roleDef.name,
            isSystem: roleDef.isSystem,
            maxDiscountPercent: roleDef.maxDiscountPercent ?? null,
          },
        });

        if (roleDef.name === 'Owner') {
          ownerRoleId = createdRole.id;
        }

        if (roleDef.permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: roleDef.permissions.map((key) => ({
              tenantId: tenant.id,
              roleId: createdRole.id,
              permissionKey: key,
            })),
          });
        }
      }

      // 4. Create Owner User
      const ownerUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: data.owner.name,
          email: data.owner.email,
          phone: data.owner.phone || null,
          passwordHash: data.owner.passwordHash,
          pinHash: data.owner.pinHash || null,
          isActive: true,
        },
      });

      // 5. Assign Owner Role to Owner User
      if (ownerRoleId) {
        await tx.userRole.create({
          data: {
            tenantId: tenant.id,
            userId: ownerUser.id,
            roleId: ownerRoleId,
          },
        });
      }

      // 6. Assign User to primary Branch
      await tx.userBranch.create({
        data: {
          tenantId: tenant.id,
          userId: ownerUser.id,
          branchId: branch.id,
        },
      });

      // 7. Initial Audit Log
      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: ownerUser.id,
          action: 'tenant.signup',
          entityType: 'Tenant',
          entityId: tenant.id,
          after: {
            tenantId: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            businessType: tenant.businessType,
          },
          ip: data.ip,
        },
      });

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        companyName: tenant.name,
        branchId: branch.id,
        ownerId: ownerUser.id,
        ownerEmail: ownerUser.email,
      };
    });
  }
}
