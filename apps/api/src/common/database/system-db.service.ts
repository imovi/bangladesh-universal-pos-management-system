import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { Prisma } from '@prisma/client';
import { v7 as uuidv7 } from 'uuid';
import { DEFAULT_MODULES_BY_BUSINESS_TYPE, getActiveModules, type ModuleKey } from '@universal-pos/shared';

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
    maxDiscountPercent?: number;
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
            timezone: 'Asia/Dhaka',
            taxRate: 5,
          },
        },
      });

      // 2. Create primary Branch (using application-generated ID and createMany to avoid RETURNING/SELECT)
      const branchId = uuidv7();
      await tx.branch.createMany({
        data: [
          {
            id: branchId,
            tenantId: tenant.id,
            name: data.branch.name,
            code: data.branch.code,
            address: data.branch.address || null,
            isActive: true,
          },
        ],
      });

      // 3. Seed System Roles and their permissions (using createMany without SELECT/RETURNING)
      let ownerRoleId: string | undefined;
      const roleRecords: Array<{
        id: string;
        tenantId: string;
        name: string;
        isSystem: boolean;
        maxDiscountPercent: number;
      }> = [];
      const roleIdMap = new Map<string, string>();

      for (const roleDef of data.roles) {
        const roleId = uuidv7();
        roleIdMap.set(roleDef.name, roleId);
        roleRecords.push({
          id: roleId,
          tenantId: tenant.id,
          name: roleDef.name,
          isSystem: roleDef.isSystem,
          maxDiscountPercent: roleDef.maxDiscountPercent ?? 0,
        });

        if (roleDef.name === 'Owner') {
          ownerRoleId = roleId;
        }
      }

      if (roleRecords.length > 0) {
        await tx.role.createMany({
          data: roleRecords,
        });
      }

      const rolePermissionRecords: Array<{
        id: string;
        tenantId: string;
        roleId: string;
        permissionKey: string;
      }> = [];

      for (const roleDef of data.roles) {
        const roleId = roleIdMap.get(roleDef.name)!;
        for (const key of roleDef.permissions) {
          rolePermissionRecords.push({
            id: uuidv7(),
            tenantId: tenant.id,
            roleId,
            permissionKey: key,
          });
        }
      }

      if (rolePermissionRecords.length > 0) {
        await tx.rolePermission.createMany({
          data: rolePermissionRecords,
        });
      }

      // 4. Create Owner User (using application-generated ID and createMany)
      const ownerUserId = uuidv7();
      await tx.user.createMany({
        data: [
          {
            id: ownerUserId,
            tenantId: tenant.id,
            name: data.owner.name,
            email: data.owner.email,
            phone: data.owner.phone || null,
            passwordHash: data.owner.passwordHash,
            pinHash: data.owner.pinHash || null,
            isActive: true,
          },
        ],
      });

      // 5. Assign Owner Role to Owner User
      if (ownerRoleId) {
        await tx.userRole.createMany({
          data: [
            {
              id: uuidv7(),
              tenantId: tenant.id,
              userId: ownerUserId,
              roleId: ownerRoleId,
            },
          ],
        });
      }

      // 6. Assign User to primary Branch
      await tx.userBranch.createMany({
        data: [
          {
            id: uuidv7(),
            tenantId: tenant.id,
            userId: ownerUserId,
            branchId,
          },
        ],
      });

      // 7. Initial Audit Log
      await tx.auditLog.createMany({
        data: [
          {
            id: uuidv7(),
            tenantId: tenant.id,
            actorUserId: ownerUserId,
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
        ],
      });

      // 8. Seed Default Modules based on business type
      const defaultModules = DEFAULT_MODULES_BY_BUSINESS_TYPE[data.businessType] || [];
      if (defaultModules.length > 0) {
        await tx.featureFlag.createMany({
          data: defaultModules.map((moduleKey) => ({
            id: uuidv7(),
            tenantId: tenant.id,
            key: `module.${moduleKey}`,
            allowed: true,
            enabled: true,
          })),
        });
      }

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        companyName: tenant.name,
        branchId,
        ownerId: ownerUserId,
        ownerEmail: data.owner.email,
      };
    });
  }

  /**
   * Finds a platform admin by ID using pos_system role.
   */
  async findPlatformAdminById(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.platformAdmin.findUnique({
        where: { id },
      });
    });
  }

  /**
   * Finds a platform admin by email using pos_system role.
   */
  async findPlatformAdminByEmail(email: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.platformAdmin.findUnique({
        where: { email },
      });
    });
  }

  /**
   * Updates platform admin lastLoginAt.
   */
  async updatePlatformAdminLastLogin(id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      return tx.platformAdmin.update({
        where: { id },
        data: { lastLoginAt: new Date() },
      });
    });
  }

  /**
   * Retrieves all tenants along with their module feature flags for Platform view.
   */
  async getAllTenantsWithModules() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
      const tenants = await tx.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          businessType: true,
          status: true,
          featureFlags: {
            where: { key: { startsWith: 'module.' } },
            select: { key: true, allowed: true, enabled: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      return tenants.map((t) => {
        const activeModules = getActiveModules(t.featureFlags);
        return {
          id: t.id,
          name: t.name,
          slug: t.slug,
          businessType: t.businessType,
          status: t.status,
          modules: t.featureFlags.map((f) => {
            const key = f.key.replace(/^module\./, '') as ModuleKey;
            return {
              key,
              allowed: f.allowed,
              enabled: f.enabled,
              active: activeModules.includes(key),
            };
          }),
        };
      });
    });
  }

  /**
   * Platform admin updates allowed status of a module for a tenant.
   * Keeps enabled status as is. Writes an audit log with platformActor details.
   */
  async updateTenantModuleAllowed(
    tenantId: string,
    moduleKey: string,
    allowed: boolean,
    platformAdmin: { id: string; email: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_system;`;

      const tenant = await tx.tenant.findUnique({
        where: { id: tenantId },
      });
      if (!tenant) {
        throw new NotFoundException({
          code: 'TENANT_NOT_FOUND',
          message: 'Tenant not found',
        });
      }
      const flagKey = `module.${moduleKey}`;
      const existing = await tx.featureFlag.findUnique({
        where: { tenantId_key: { tenantId, key: flagKey } },
      });

      const oldAllowed = existing?.allowed ?? false;
      const oldEnabled = existing?.enabled ?? false;

      let updatedFlag;
      if (existing) {
        updatedFlag = await tx.featureFlag.update({
          where: { id: existing.id },
          data: { allowed },
        });
      } else {
        updatedFlag = await tx.featureFlag.create({
          data: {
            id: uuidv7(),
            tenantId,
            key: flagKey,
            allowed,
            enabled: false,
          },
        });
      }

      // Write audit log in that tenant's log (actorUserId is null, platformActor in after)
      await tx.auditLog.createMany({
        data: [
          {
            id: uuidv7(),
            tenantId,
            actorUserId: null,
            action: 'platform.module.update',
            entityType: 'Module',
            entityId: moduleKey,
            before: {
              key: moduleKey,
              allowed: oldAllowed,
              enabled: oldEnabled,
            },
            after: {
              key: moduleKey,
              allowed,
              enabled: updatedFlag.enabled,
              platformActor: {
                id: platformAdmin.id,
                email: platformAdmin.email,
              },
            },
          },
        ],
      });

      return {
        key: moduleKey,
        allowed: updatedFlag.allowed,
        enabled: updatedFlag.enabled,
        active: Boolean(updatedFlag.allowed && updatedFlag.enabled),
      };
    });
  }
}
