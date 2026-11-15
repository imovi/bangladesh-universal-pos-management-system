import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestAdminPrismaClient } from "./test-db-helper.js";

interface TableRlsCatalogueRow {
  table_name: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  has_tenant_policy: boolean;
}

describe("Catalogue-driven RLS Guard Test", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestAdminPrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("fails if ANY table with tenant_id lacks RLS enabled, RLS forced, or a tenant policy for pos_app", async () => {
    const rows = await prisma.$queryRaw<TableRlsCatalogueRow[]>`
      SELECT 
        c.relname AS table_name,
        c.relrowsecurity AS rls_enabled,
        c.relforcerowsecurity AS rls_forced,
        EXISTS (
          SELECT 1 FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename = c.relname
            AND p.roles @> ARRAY['pos_app'::name]
        ) AS has_tenant_policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
      ORDER BY c.relname ASC;
    `;

    // Ensure we actually found tenant tables
    expect(rows.length).toBeGreaterThan(0);

    const violations: string[] = [];

    for (const row of rows) {
      if (!row.rls_enabled) {
        violations.push(`Table '${row.table_name}' does not have RLS enabled (ENABLE ROW LEVEL SECURITY).`);
      }
      if (!row.rls_forced) {
        violations.push(`Table '${row.table_name}' does not have RLS forced (FORCE ROW LEVEL SECURITY).`);
      }
      if (!row.has_tenant_policy) {
        violations.push(`Table '${row.table_name}' lacks a tenant_isolation_policy TO pos_app.`);
      }
    }

    if (violations.length > 0) {
      throw new Error(`Catalogue RLS Guard Violations detected:\n${violations.join("\n")}`);
    }

    expect(violations).toHaveLength(0);
  });
});
