import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createTestAdminPrismaClient } from './test-db-helper.js';

describe('Fix 1: Real Database Migrations & RLS Verification', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestAdminPrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('verifies pos_app role exists with NOLOGIN and no BYPASSRLS', async () => {
    const roles: any[] = await prisma.$queryRaw`
      SELECT rolname, rolcanlogin, rolbypassrls
      FROM pg_roles
      WHERE rolname = 'pos_app';
    `;

    expect(roles.length).toBe(1);
    expect(roles[0].rolname).toBe('pos_app');
    expect(roles[0].rolcanlogin).toBe(false);
    expect(roles[0].rolbypassrls).toBe(false);
  });

  it('verifies RLS is enabled and forced on all 9 tenant tables', async () => {
    const tenantTables = [
      'branches',
      'users',
      'roles',
      'role_permissions',
      'user_roles',
      'user_branches',
      'refresh_tokens',
      'feature_flags',
      'audit_logs',
    ];

    const tablesWithRls: any[] = await prisma.$queryRaw`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = ANY(${tenantTables}) AND relnamespace = 'public'::regnamespace;
    `;

    expect(tablesWithRls.length).toBe(tenantTables.length);
    for (const t of tablesWithRls) {
      expect(t.relrowsecurity).toBe(true);
      expect(t.relforcerowsecurity).toBe(true);
    }
  });

  it('verifies RLS policy exists for pos_app on all 9 tenant tables', async () => {
    const tenantTables = [
      'branches',
      'users',
      'roles',
      'role_permissions',
      'user_roles',
      'user_branches',
      'refresh_tokens',
      'feature_flags',
      'audit_logs',
    ];

    const policies: any[] = await prisma.$queryRaw`
      SELECT tablename, policyname, roles
      FROM pg_policies
      WHERE schemaname = 'public' AND 'pos_app' = ANY(roles);
    `;

    const policyTables = policies.map((p) => p.tablename);
    for (const expectedTable of tenantTables) {
      expect(policyTables).toContain(expectedTable);
    }
  });

  it('verifies pos_app has NO privileges on the tenants table', async () => {
    const grants: any[] = await prisma.$queryRaw`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'pos_app' AND table_name = 'tenants';
    `;

    expect(grants.length).toBe(0);
  });

  it('verifies pos_app cannot UPDATE or DELETE on audit_logs', async () => {
    const disallowed: any[] = await prisma.$queryRaw`
      SELECT privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'pos_app' AND table_name = 'audit_logs'
        AND privilege_type IN ('UPDATE', 'DELETE');
    `;

    expect(disallowed.length).toBe(0);
  });
});
