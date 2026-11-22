import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { runBackup } from "../../../scripts/backup.js";
import { runRestore } from "../../../scripts/restore.js";

const ADMIN_DB_URL =
  process.env.MIGRATION_DATABASE_URL ||
  "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public";

const RUNTIME_USER = process.env.POSTGRES_RUNTIME_USER || "pos_runtime";
const RUNTIME_PASSWORD = process.env.POSTGRES_RUNTIME_PASSWORD || "pos_runtime_secret";
const PG_HOST = process.env.POSTGRES_HOST || "localhost";
const PG_PORT = process.env.POSTGRES_PORT || 5432;

const SOURCE_DB = "universal_pos_drill_source";
const RESTORED_DB = "universal_pos_drill_restored";
const TEMP_BACKUP_DIR = path.resolve(process.cwd(), "temp-drill-backups");

describe("Milestone F2: PostgreSQL Backup & Restore Drill with RLS and Immutability Verification", () => {
  let sourcePrisma: PrismaClient;
  let restoredAdminPrisma: PrismaClient;
  let restoredRuntimePrisma: PrismaClient;

  let tenantAId: string;
  let tenantBId: string;
  let initialRowCounts: Record<string, number> = {};

  const coreTables = [
    "tenants",
    "products",
    "product_variants",
    "sales",
    "sale_items",
    "stock_movements",
    "loyalty_ledger",
    "audit_logs",
  ];

  beforeAll(async () => {
    fs.mkdirSync(TEMP_BACKUP_DIR, { recursive: true });

    // 1. Create fresh source database and populate demo records
    const masterPrisma = new PrismaClient({ datasourceUrl: ADMIN_DB_URL });
    await masterPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SOURCE_DB}";`);
    await masterPrisma.$executeRawUnsafe(`CREATE DATABASE "${SOURCE_DB}" OWNER pos_admin;`);
    await masterPrisma.$disconnect();

    const sourceAdminUrl = `postgresql://pos_admin:pos_secret@${PG_HOST}:${PG_PORT}/${SOURCE_DB}?schema=public`;
    sourcePrisma = new PrismaClient({ datasourceUrl: sourceAdminUrl });

    // Restore existing schema from main universal_pos (or apply current schema via pg_dump/pg_restore)
    const seedBackup = runBackup({
      database: "universal_pos",
      backupDir: TEMP_BACKUP_DIR,
    });

    await runRestore({
      backupFile: seedBackup.filePath,
      targetDb: SOURCE_DB,
      backupDir: TEMP_BACKUP_DIR,
    });

    // Capture pre-drill tenant IDs and row counts
    const tenants: any = await sourcePrisma.$queryRawUnsafe(`SELECT id FROM "tenants" LIMIT 2`);
    expect(tenants.length).toBeGreaterThanOrEqual(1);
    tenantAId = tenants[0].id;
    tenantBId = tenants[1]?.id || tenants[0].id;

    for (const table of coreTables) {
      const res: any = await sourcePrisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "${table}"`);
      initialRowCounts[table] = res[0]?.count ?? 0;
    }

    await sourcePrisma.$disconnect();
  }, 60000);

  afterAll(async () => {
    if (restoredAdminPrisma) await restoredAdminPrisma.$disconnect().catch(() => {});
    if (restoredRuntimePrisma) await restoredRuntimePrisma.$disconnect().catch(() => {});

    // Clean up temporary databases and files
    try {
      const masterPrisma = new PrismaClient({ datasourceUrl: ADMIN_DB_URL });
      await masterPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SOURCE_DB}";`);
      await masterPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${RESTORED_DB}";`);
      await masterPrisma.$disconnect();
    } catch {}

    if (fs.existsSync(TEMP_BACKUP_DIR)) {
      fs.rmSync(TEMP_BACKUP_DIR, { recursive: true, force: true });
    }
  });

  it("1. backs up the database, drops it, and restores into a fresh database", async () => {
    // Perform backup of SOURCE_DB
    const backupResult = runBackup({
      database: SOURCE_DB,
      backupDir: TEMP_BACKUP_DIR,
    });

    expect(backupResult.filename).toBeDefined();
    expect(backupResult.sizeBytes).toBeGreaterThan(0);
    expect(backupResult.checksum).toHaveLength(64);

    // Drop SOURCE_DB to prove no dependence on original
    const masterPrisma = new PrismaClient({ datasourceUrl: ADMIN_DB_URL });
    await masterPrisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SOURCE_DB}";`);
    await masterPrisma.$disconnect();

    // Restore into fresh RESTORED_DB
    const restoreResult = await runRestore({
      backupFile: backupResult.filePath,
      targetDb: RESTORED_DB,
      backupDir: TEMP_BACKUP_DIR,
    });

    expect(restoreResult.status).toBe("success");
    expect(restoreResult.database).toBe(RESTORED_DB);
  }, 45000);

  it("2. asserts row counts match for all 8 core tables (tenants, products, variants, sales, sale items, stock movements, loyalty ledger, audit logs)", async () => {
    const restoredAdminUrl = `postgresql://pos_admin:pos_secret@${PG_HOST}:${PG_PORT}/${RESTORED_DB}?schema=public`;
    restoredAdminPrisma = new PrismaClient({ datasourceUrl: restoredAdminUrl });

    for (const table of coreTables) {
      const res: any = await restoredAdminPrisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "${table}"`);
      const restoredCount = res[0]?.count ?? 0;
      expect(restoredCount).toBe(initialRowCounts[table]);
    }
  });

  it("3. verifies tenant isolation (RLS) is preserved on the restored database", async () => {
    const restoredRuntimeUrl = `postgresql://${RUNTIME_USER}:${RUNTIME_PASSWORD}@${PG_HOST}:${PG_PORT}/${RESTORED_DB}?schema=public`;
    restoredRuntimePrisma = new PrismaClient({ datasourceUrl: restoredRuntimeUrl });

    // Verify non-superuser status
    const superuserRes: any = await restoredRuntimePrisma.$queryRawUnsafe(`SELECT current_setting('is_superuser') as superuser`);
    expect(superuserRes[0]?.superuser).toBe("off");

    // Connect under Tenant A's tenant context
    await restoredRuntimePrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true);`);

      const tenantASales: any = await tx.$queryRawUnsafe(`SELECT id, tenant_id FROM "sales"`);
      for (const sale of tenantASales) {
        expect(sale.tenant_id).toBe(tenantAId);
      }

      // Direct query attempting to bypass context and filter for Tenant B must return 0 rows under RLS
      if (tenantAId !== tenantBId) {
        const tenantBSalesUnderAContext: any = await tx.$queryRawUnsafe(
          `SELECT id FROM "sales" WHERE tenant_id = '${tenantBId}'`
        );
        expect(tenantBSalesUnderAContext.length).toBe(0);
      }
    });
  });

  it("4. verifies audit_logs and loyalty_ledger remain strictly append-only (immutability)", async () => {
    // Under pos_app role, UPDATE on audit_logs must fail with permission denied
    await expect(
      restoredRuntimePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true);`);
        await tx.$executeRawUnsafe(`UPDATE audit_logs SET action = 'tampered' WHERE true;`);
      })
    ).rejects.toThrow(/permission denied/i);

    // Under pos_app role, DELETE on audit_logs must fail with permission denied
    await expect(
      restoredRuntimePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true);`);
        await tx.$executeRawUnsafe(`DELETE FROM audit_logs WHERE true;`);
      })
    ).rejects.toThrow(/permission denied/i);

    // Under pos_app role, UPDATE on loyalty_ledger must fail with permission denied
    await expect(
      restoredRuntimePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true);`);
        await tx.$executeRawUnsafe(`UPDATE loyalty_ledger SET points = 999999 WHERE true;`);
      })
    ).rejects.toThrow(/permission denied/i);

    // Under pos_app role, DELETE on loyalty_ledger must fail with permission denied
    await expect(
      restoredRuntimePrisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', '${tenantAId}', true);`);
        await tx.$executeRawUnsafe(`DELETE FROM loyalty_ledger WHERE true;`);
      })
    ).rejects.toThrow(/permission denied/i);
  });
});
