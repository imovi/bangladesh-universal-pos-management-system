import { describe, it, expect } from "vitest";
import { assertTestDatabase } from "./test-db-helper.js";
import { execSync } from "child_process";
import path from "path";

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
  });

  it("refuses seed-demo on non-development and non-test databases", () => {
    let error: any;
    try {
      execSync("npx tsx scripts/seed-demo.ts", {
        cwd: path.resolve(__dirname, "../../.."),
        stdio: "pipe",
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: "postgresql://pos_admin:pos_secret@localhost:5432/production_pos?schema=public",
        },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeDefined();
    const output = (error.stderr || error.stdout || "").toString();
    expect(output).toContain("Refusing destructive tenant clear on non-development database 'production_pos'");
  });
});
