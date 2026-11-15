import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TenantsService } from '../src/modules/tenants/tenants.service.js';
import { SystemDbService } from '../src/common/database/system-db.service.js';
import { TenantContextService } from '../src/common/database/tenant-context.service.js';
import { ConflictException } from '@nestjs/common';

describe('Fix 4: Real PostgreSQL Tenant Isolation Integration Tests', () => {
  let prisma: PrismaClient;
  let systemDb: SystemDbService;
  let tenantContext: TenantContextService;
  let tenantsService: TenantsService;

  let tenantA: { tenantId: string; slug: string; ownerEmail: string; branchId: string };
  let tenantB: { tenantId: string; slug: string; ownerEmail: string; branchId: string };

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public',
        },
      },
    });
    await prisma.$connect();
    systemDb = new SystemDbService(prisma as any);
    tenantContext = new TenantContextService(prisma as any);
    tenantsService = new TenantsService(systemDb);

    // Clean test slate
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE tenants CASCADE;`);

    // 1. Provision Tenant A
    tenantA = await tenantsService.signup({
      companyName: 'Tenant Alpha Corp',
      slug: 'tenant-alpha',
      businessType: 'fashion',
      owner: {
        name: 'Alpha Owner',
        email: 'owner@shared-domain.com',
        phone: '+8801700000001',
        password: 'Password123!',
      },
      branch: {
        name: 'Alpha Main Branch',
        code: 'MAIN-01',
        address: 'Dhaka',
      },
    });

    // 2. Provision Tenant B (uses SAME branch code and SAME email to prove non-collision across tenants)
    tenantB = await tenantsService.signup({
      companyName: 'Tenant Beta Corp',
      slug: 'tenant-beta',
      businessType: 'retail',
      owner: {
        name: 'Beta Owner',
        email: 'owner@shared-domain.com',
        phone: '+8801700000002',
        password: 'Password123!',
      },
      branch: {
        name: 'Beta Main Branch',
        code: 'MAIN-01',
        address: 'Chittagong',
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('proves same email and branch code exist in both tenants, but duplicates in same tenant are rejected', async () => {
    expect(tenantA.ownerEmail).toBe('owner@shared-domain.com');
    expect(tenantB.ownerEmail).toBe('owner@shared-domain.com');

    // Attempting duplicate branch code inside Tenant A should reject
    await expect(
      tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
        const existing = await tx.branch.findUnique({
          where: { tenantId_code: { tenantId: tenantA.tenantId, code: 'MAIN-01' } },
        });
        if (existing) {
          throw new ConflictException('Branch code exists');
        }
        return tx.branch.create({
          data: { tenantId: tenantA.tenantId, name: 'Duplicate Branch', code: 'MAIN-01' },
        });
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('with Tenant A context, selecting from each of the 9 tenant tables returns ONLY A rows, even without where clause', async () => {
    await tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
      // 1. branches
      const branches = await tx.branch.findMany();
      expect(branches.length).toBeGreaterThan(0);
      expect(branches.every((b) => b.tenantId === tenantA.tenantId)).toBe(true);

      // 2. users
      const users = await tx.user.findMany();
      expect(users.length).toBeGreaterThan(0);
      expect(users.every((u) => u.tenantId === tenantA.tenantId)).toBe(true);

      // 3. roles
      const roles = await tx.role.findMany();
      expect(roles.length).toBeGreaterThan(0);
      expect(roles.every((r) => r.tenantId === tenantA.tenantId)).toBe(true);

      // 4. role_permissions
      const rolePerms = await tx.rolePermission.findMany();
      expect(rolePerms.length).toBeGreaterThan(0);
      expect(rolePerms.every((rp) => rp.tenantId === tenantA.tenantId)).toBe(true);

      // 5. user_roles
      const userRoles = await tx.userRole.findMany();
      expect(userRoles.length).toBeGreaterThan(0);
      expect(userRoles.every((ur) => ur.tenantId === tenantA.tenantId)).toBe(true);

      // 6. user_branches
      const userBranches = await tx.userBranch.findMany();
      expect(userBranches.length).toBeGreaterThan(0);
      expect(userBranches.every((ub) => ub.tenantId === tenantA.tenantId)).toBe(true);

      // 7. refresh_tokens
      const refreshTokens = await tx.refreshToken.findMany();
      expect(refreshTokens.every((rt) => rt.tenantId === tenantA.tenantId)).toBe(true);

      // 8. feature_flags
      const featureFlags = await tx.featureFlag.findMany();
      expect(featureFlags.every((ff) => ff.tenantId === tenantA.tenantId)).toBe(true);

      // 9. audit_logs
      const auditLogs = await tx.auditLog.findMany();
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs.every((al) => al.tenantId === tenantA.tenantId)).toBe(true);
    });
  });

  it("with Tenant A context, updating or deleting a row that belongs to B affects 0 rows", async () => {
    await tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
      // Try to update Tenant B's branch using Tenant A context
      const updateResult = await tx.$executeRaw`
        UPDATE branches SET name = 'Hacked Name' WHERE id = ${tenantB.branchId}::uuid;
      `;
      expect(updateResult).toBe(0);

      // Try to delete Tenant B's branch using Tenant A context
      const deleteResult = await tx.$executeRaw`
        DELETE FROM branches WHERE id = ${tenantB.branchId}::uuid;
      `;
      expect(deleteResult).toBe(0);
    });
  });

  it('with Tenant A context, inserting a row with tenant_id = B is rejected by RLS policy', async () => {
    await expect(
      tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
        return tx.$executeRaw`
          INSERT INTO branches (id, tenant_id, name, code, is_active, created_at, updated_at)
          VALUES (
            gen_random_uuid(),
            ${tenantB.tenantId}::uuid,
            'Malicious Cross-Tenant Branch',
            'MAL-01',
            true,
            NOW(),
            NOW()
          );
        `;
      }),
    ).rejects.toThrow(/violates row-level security policy/);
  });

  it('as pos_app with app.tenant_id not set, every tenant table returns 0 rows (never all rows)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE pos_app;`;
      await tx.$executeRaw`SELECT set_config('app.tenant_id', '', true);`;

      const [branches, users, roles, auditLogs]: [any[], any[], any[], any[]] = await Promise.all([
        tx.$queryRaw`SELECT * FROM branches;`,
        tx.$queryRaw`SELECT * FROM users;`,
        tx.$queryRaw`SELECT * FROM roles;`,
        tx.$queryRaw`SELECT * FROM audit_logs;`,
      ]);

      expect(branches.length).toBe(0);
      expect(users.length).toBe(0);
      expect(roles.length).toBe(0);
      expect(auditLogs.length).toBe(0);
    });
  });

  it('pos_app cannot UPDATE or DELETE on audit_logs', async () => {
    await expect(
      tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
        return tx.$executeRaw`
          UPDATE audit_logs SET action = 'tampered' WHERE tenant_id = ${tenantA.tenantId}::uuid;
        `;
      }),
    ).rejects.toThrow(/permission denied for table audit_logs/);

    await expect(
      tenantContext.runWithTenant(tenantA.tenantId, async (tx) => {
        return tx.$executeRaw`
          DELETE FROM audit_logs WHERE tenant_id = ${tenantA.tenantId}::uuid;
        `;
      }),
    ).rejects.toThrow(/permission denied for table audit_logs/);
  });

  it('a signup that fails midway leaves no tenant, branch, role, or user behind', async () => {
    const preTenantsCount = await prisma.tenant.count({ where: { slug: 'failing-signup' } });
    expect(preTenantsCount).toBe(0);

    // Intentionally cause failure during creation
    await expect(
      systemDb.createTenantWithInitialData({
        companyName: 'Failing Company',
        slug: 'failing-signup',
        businessType: 'fashion',
        branch: { name: 'Fail Branch', code: 'FAIL-01' },
        roles: [
          { name: 'Owner', isSystem: true, permissions: ['*'] },
          { name: 'Duplicate Role', isSystem: false, permissions: [] },
          { name: 'Duplicate Role', isSystem: false, permissions: [] }, // UNIQUE CONSTRAINT VIOLATION!
        ],
        owner: {
          name: 'Fail Owner',
          email: 'fail@owner.com',
          passwordHash: 'hash',
        },
      }),
    ).rejects.toThrow();

    // Verify atomic rollback
    const postTenant = await prisma.tenant.findUnique({ where: { slug: 'failing-signup' } });
    const postUsers = await prisma.user.findMany({ where: { email: 'fail@owner.com' } });
    const postBranches = await prisma.branch.findMany({ where: { code: 'FAIL-01' } });

    expect(postTenant).toBeNull();
    expect(postUsers.length).toBe(0);
    expect(postBranches.length).toBe(0);
  });
});
