import {
  Injectable,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import argon2 from "argon2";
import {
  TenantSignupDto,
  TenantSignupSchema,
  SYSTEM_ROLES,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRole,
} from "@universal-pos/shared";

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async signup(payload: TenantSignupDto, ip?: string) {
    const parseResult = TenantSignupSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid registration details",
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join("."),
          issue: e.message,
        })),
      });
    }

    const { companyName, slug, businessType, owner, branch } = parseResult.data;

    // Verify slug uniqueness
    const existingTenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });
    if (existingTenant) {
      throw new ConflictException({
        code: "SLUG_ALREADY_EXISTS",
        message: "This tenant slug is already taken. Please choose another.",
      });
    }

    // Atomic transaction creating entire tenant foundation
    return this.prisma.$transaction(async (tx) => {
      // 1. Create Tenant
      const tenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          businessType,
          status: "active",
          settings: {
            currency: "BDT",
            language: "bn",
            taxRate: 5,
          },
        },
      });

      // 2. Create primary Branch
      const createdBranch = await tx.branch.create({
        data: {
          tenantId: tenant.id,
          name: branch.name,
          code: branch.code,
          address: branch.address || null,
          isActive: true,
        },
      });

      // 3. Seed System Roles & Permissions
      const roleMap = new Map<SystemRole, string>();

      for (const [roleName, permissions] of Object.entries(
        SYSTEM_ROLE_PERMISSIONS,
      ) as [SystemRole, string[]][]) {
        const createdRole = await tx.role.create({
          data: {
            tenantId: tenant.id,
            name: roleName,
            isSystem: true,
          },
        });

        roleMap.set(roleName, createdRole.id);

        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((key) => ({
              tenantId: tenant.id,
              roleId: createdRole.id,
              permissionKey: key,
            })),
          });
        }
      }

      // 4. Hash owner credentials
      const passwordHash = await argon2.hash(owner.password);
      const pinHash = owner.pin ? await argon2.hash(owner.pin) : null;

      // 5. Create Owner user
      const createdUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: owner.name,
          email: owner.email,
          phone: owner.phone,
          passwordHash,
          pinHash,
          isActive: true,
        },
      });

      // 6. Assign Owner role
      const ownerRoleId = roleMap.get(SYSTEM_ROLES.OWNER);
      if (ownerRoleId) {
        await tx.userRole.create({
          data: {
            tenantId: tenant.id,
            userId: createdUser.id,
            roleId: ownerRoleId,
          },
        });
      }

      // 7. Assign User to default branch
      await tx.userBranch.create({
        data: {
          tenantId: tenant.id,
          userId: createdUser.id,
          branchId: createdBranch.id,
        },
      });

      // 8. Log tenant registration in audit log
      await this.auditService.log(
        {
          tenantId: tenant.id,
          actorUserId: createdUser.id,
          action: "tenant.signup",
          entityType: "Tenant",
          entityId: tenant.id,
          after: {
            tenantId: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            businessType: tenant.businessType,
          },
          ip,
        },
        tx,
      );

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        companyName: tenant.name,
        branchId: createdBranch.id,
        ownerId: createdUser.id,
        ownerEmail: createdUser.email,
      };
    });
  }
}
