import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

describe('Fix 7: Primary Key UUID v7 Verification', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public',
        },
      },
    });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies that newly created rows receive UUID version 7 primary keys by default', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        name: 'UUID v7 Test Store',
        slug: `uuid7-test-${Date.now()}`,
        businessType: 'retail',
      },
    });

    expect(tenant.id).toBeDefined();

    // UUID v7 format check: 8-4-4-4-12 hex chars where version nibble (13th char, index 14) is '7'
    const uuidV7Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(tenant.id).toMatch(uuidV7Regex);

    // Also verify branch creation gets UUID v7
    const branch = await prisma.branch.create({
      data: {
        tenantId: tenant.id,
        name: 'UUID7 Branch',
        code: `U7-${Date.now().toString().slice(-4)}`,
      },
    });

    expect(branch.id).toMatch(uuidV7Regex);

    // Verify user creation gets UUID v7
    const user = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `u7-${Date.now()}@example.com`,
        name: 'UUID7 User',
        passwordHash: 'hash',
      },
    });
    expect(user.id).toMatch(uuidV7Regex);

    // Verify role creation gets UUID v7
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        name: `u7-role-${Date.now()}`,
      },
    });
    expect(role.id).toMatch(uuidV7Regex);

    // Verify rolePermission creation gets UUID v7
    const rolePermission = await prisma.rolePermission.create({
      data: {
        tenantId: tenant.id,
        roleId: role.id,
        permissionKey: 'pos:test',
      },
    });
    expect(rolePermission.id).toMatch(uuidV7Regex);
  });
});
