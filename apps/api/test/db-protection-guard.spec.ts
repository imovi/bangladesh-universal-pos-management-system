import { describe, it, expect } from "vitest";
import { assertTestDatabase } from "./test-db-helper.js";
import { execSync } from "child_process";
import path from "path";
import { PrismaClient } from "@prisma/client";

describe("Database Protection Guard", () => {
  it("allows test and e2e database URLs", () => {
    expect(() =>
      assertTestDatabase("postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_test?schema=public"),
    ).not.toThrow();

    expect(() =>
      assertTestDatabase("postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public"),
    ).not.toThrow();
  });

  it("refuses destructive operations on non-test databases", () => {
    expect(() =>
      assertTestDatabase("postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public"),
    ).toThrow(/Refusing to execute destructive operations against database 'universal_pos'/);

    expect(() =>
      assertTestDatabase("postgresql://pos_admin:pos_secret@localhost:5432/postgres?schema=public"),
    ).toThrow(/Refusing to execute destructive operations against database 'postgres'/);

    expect(() =>
      assertTestDatabase("postgresql://pos_admin:pos_secret@localhost:5432/prod_db?schema=public"),
    ).toThrow(/Refusing to execute destructive operations against database 'prod_db'/);
  });

  it("refuses db:reset:dev without --yes flag", () => {
    let error: any;
    try {
      execSync("npx tsx scripts/reset-dev-db.ts", {
        cwd: path.resolve(__dirname, "../../.."),
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public",
        },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    const output = (error.stderr || error.stdout || "").toString();
    expect(output).toContain("Run with '--yes' to confirm");
  }, 20000);

  it("refuses seed-demo on universal_pos without --yes flag and deletes nothing", () => {
    let error: any;
    try {
      execSync("npx tsx scripts/seed-demo.ts", {
        cwd: path.resolve(__dirname, "../../.."),
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "development",
          DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public",
          MIGRATION_DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos?schema=public",
        },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    const output = (error.stderr || error.stdout || "").toString();
    expect(output).toContain("Pass --yes to confirm");
  }, 20000);

  it("leaves existing tenant in place when seed fails during app boot on _e2e database", async () => {
    // 1. Run seed cleanly first on e2e to guarantee tenant exists
    execSync("npx tsx scripts/seed-demo.ts", {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public",
        MIGRATION_DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public",
      },
    });

    const prisma = new PrismaClient({
      datasources: { db: { url: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public" } },
    });
    const beforeCount = await prisma.tenant.count({ where: { slug: "artisan-apparel" } });
    expect(beforeCount).toBeGreaterThan(0);

    // 2. Now simulate boot failure during seed
    let error: any;
    try {
      execSync("npx tsx scripts/seed-demo.ts", {
        cwd: path.resolve(__dirname, "../../.."),
        stdio: "pipe",
        env: {
          ...process.env,
          NODE_ENV: "test",
          FAIL_SEED_BOOT: "true",
          DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public",
          MIGRATION_DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public",
        },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    const output = (error.stderr || error.stdout || "").toString();
    expect(output).toContain("Simulated application boot failure before tenant clearing");

    // 3. Verify tenant was NOT cleared and is still intact in universal_pos_e2e
    const afterCount = await prisma.tenant.count({ where: { slug: "artisan-apparel" } });
    await prisma.$disconnect();
    expect(afterCount).toBe(beforeCount);
  }, 30000);
});
