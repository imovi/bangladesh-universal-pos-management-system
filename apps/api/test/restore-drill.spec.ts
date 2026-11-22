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

  async function seedDrillSourceData(prisma: PrismaClient) {
    const tAId = "01934c56-0001-7000-8000-000000000001";
    const tBId = "01934c56-0002-7000-8000-000000000002";
    const branchId = "01934c56-0003-7000-8000-000000000003";
    const userId = "01934c56-0004-7000-8000-000000000004";
    const regId = "01934c56-0005-7000-8000-000000000005";
    const shiftId = "01934c56-0006-7000-8000-000000000006";
    const catId = "01934c56-0007-7000-8000-000000000007";
    const prodId = "01934c56-0008-7000-8000-000000000008";
    const varId = "01934c56-0009-7000-8000-000000000009";
    const saleId = "01934c56-0010-7000-8000-000000000010";
    const saleItemId = "01934c56-0011-7000-8000-000000000011";
    const custId = "01934c56-0012-7000-8000-000000000012";

    await prisma.$executeRawUnsafe(`
      INSERT INTO "tenants" (id, name, slug, business_type, status)
      VALUES ('${tAId}', 'Drill Tenant A', 'drill-tenant-a', 'fashion', 'ACTIVE'),
             ('${tBId}', 'Drill Tenant B', 'drill-tenant-b', 'fashion', 'ACTIVE');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "branches" (id, tenant_id, name, code, address)
      VALUES ('${branchId}', '${tAId}', 'Flagship Branch', 'BR01', 'Dhaka');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "users" (id, tenant_id, name, email, phone, password_hash, status)
      VALUES ('${userId}', '${tAId}', 'Cashier A', 'cashier@drilla.com', '+8801700000099', 'hash', 'ACTIVE');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "registers" (id, tenant_id, branch_id, name, code)
      VALUES ('${regId}', '${tAId}', '${branchId}', 'Register 01', 'REG01');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "shifts" (id, tenant_id, branch_id, register_id, opened_by_user_id, status, opened_at, starting_cash_minor)
      VALUES ('${shiftId}', '${tAId}', '${branchId}', '${regId}', '${userId}', 'OPEN', NOW(), 100000);
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "categories" (id, tenant_id, name, slug)
      VALUES ('${catId}', '${tAId}', 'Clothing', 'clothing');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "products" (id, tenant_id, category_id, name, slug, type, status, pricing_type)
      VALUES ('${prodId}', '${tAId}', '${catId}', 'Panjabi', 'panjabi', 'STANDARD', 'ACTIVE', 'FIXED');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "product_variants" (id, tenant_id, product_id, sku, price_minor, cost_price_minor, status)
      VALUES ('${varId}', '${tAId}', '${prodId}', 'PAN-01', 250000, 150000, 'ACTIVE');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "stock_movements" (tenant_id, branch_id, variant_id, qty_delta, type, unit_cost_minor, actor_user_id)
      VALUES ('${tAId}', '${branchId}', '${varId}', 50, 'OPENING', 150000, '${userId}');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "customers" (id, tenant_id, name, phone)
      VALUES ('${custId}', '${tAId}', 'Drill Customer', '+8801711998877');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "sales" (id, tenant_id, invoice_number, shift_id, branch_id, cashier_user_id, customer_id, status, subtotal_minor, total_minor, paid_minor)
      VALUES ('${saleId}', '${tAId}', 'INV-DRILL-001', '${shiftId}', '${branchId}', '${userId}', '${custId}', 'completed', 250000, 250000, 250000);
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "sale_items" (id, tenant_id, sale_id, variant_id, product_name, variant_sku, quantity, unit_price_minor, total_minor)
      VALUES ('${saleItemId}', '${tAId}', '${saleId}', '${varId}', 'Panjabi', 'PAN-01', 1, 250000, 250000);
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "loyalty_ledger" (tenant_id, customer_id, type, points, reason)
      VALUES ('${tAId}', '${custId}', 'EARN', 25, 'Drill purchase');
    `);

    await prisma.$executeRawUnsafe(`
      INSERT INTO "audit_logs" (tenant_id, actor_user_id, action, entity_type, entity_id)
      VALUES ('${tAId}', '${userId}', 'DRILL_INIT', 'DATABASE', '${prodId}');
    `);
  }

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
    let tenants: any = await sourcePrisma.$queryRawUnsafe(`SELECT id FROM "tenants" LIMIT 2`);
    if (!tenants || tenants.length === 0) {
      await seedDrillSourceData(sourcePrisma);
      tenants = await sourcePrisma.$queryRawUnsafe(`SELECT id FROM "tenants" LIMIT 2`);
    }

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
