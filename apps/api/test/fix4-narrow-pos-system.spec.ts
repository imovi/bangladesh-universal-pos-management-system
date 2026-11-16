import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestPrismaClient, truncateTestDatabase } from "./test-db-helper.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { PrismaService } from "../src/common/database/prisma.service.js";
import { v7 as uuidv7 } from "uuid";

describe("Fix 4: Narrow pos_system Privileges & Verify Broad Read Removal", () => {
  let prisma: PrismaClient;
  let systemDb: SystemDbService;

  beforeAll(async () => {
    await truncateTestDatabase();
    // Ensure Fix 4 migration statements are applied to test db
    const adminPrisma = (await import("./test-db-helper.js")).createTestAdminPrismaClient();
    await adminPrisma.$connect();
    const fs = await import("fs");
    const path = await import("path");
    const migrationSubPath = process.cwd().endsWith("api")
      ? "prisma/migrations/20261116160000_fix4_narrow_pos_system_policies/migration.sql"
      : "apps/api/prisma/migrations/20261116160000_fix4_narrow_pos_system_policies/migration.sql";
    const sql = fs.readFileSync(path.resolve(process.cwd(), migrationSubPath), "utf-8");
    const cleanedSql = sql.replace(/--.*$/gm, "");
    const statements = cleanedSql.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const stmt of statements) {
      await adminPrisma.$executeRawUnsafe(stmt);
    }
    await adminPrisma.$disconnect();

    prisma = createTestPrismaClient();
    await prisma.$connect();
    const prismaService = new PrismaService();
    await prismaService.$connect();
    systemDb = new SystemDbService(prismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const tablesToCheck = [
    "users",
    "roles",
    "branches",
    "user_roles",
    "user_branches",
    "role_permissions",
    "audit_logs",
  ];

  for (const table of tablesToCheck) {
    it(`strictly denies SELECT on '${table}' when switched to pos_system (permission denied)`, async () => {
      // 1. Assert has_table_privilege is false
      const privResult = await prisma.$queryRawUnsafe<Array<{ has_priv: boolean }>>(
        `SELECT has_table_privilege('pos_system', 'public."${table}"', 'SELECT') as has_priv;`
      );
      expect(privResult[0].has_priv).toBe(false);

      // 2. Assert executing SELECT throws 42501 permission denied
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL ROLE pos_system;`;
          return tx.$queryRawUnsafe(`SELECT * FROM public."${table}" LIMIT 1;`);
        })
      ).rejects.toThrow(/permission denied/i);
    });
  }

  it("successfully signs up a new tenant via createTenantWithInitialData without needing SELECT on the 7 tables", async () => {
    const signupSlug = `test-fix4-${Date.now()}`;
    const result = await systemDb.createTenantWithInitialData({
      companyName: "Fix4 Test Shop",
      slug: signupSlug,
      businessType: "fashion",
      branch: {
        name: "Main Branch",
        code: "MAIN",
      },
      roles: [
        {
          name: "Owner",
          isSystem: true,
          permissions: ["tenant.read", "tenant.update", "sale.create"],
          maxDiscountPercent: 100,
        },
        {
          name: "Cashier",
          isSystem: true,
          permissions: ["sale.create"],
          maxDiscountPercent: 5,
        },
      ],
      owner: {
        name: "Fix4 Owner",
        email: `owner-${signupSlug}@test.com`,
        passwordHash: "$2b$10$abcdefghijklmnopqrstuvwxyz123456",
      },
      ip: "127.0.0.1",
    });

    expect(result.tenantId).toBeDefined();
    expect(result.slug).toBe(signupSlug);
    expect(result.branchId).toBeDefined();
    expect(result.ownerId).toBeDefined();

    // Verify tenant is readable by slug through pos_system
    const found = await systemDb.findTenantBySlug(signupSlug);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Fix4 Test Shop");
  });
});
