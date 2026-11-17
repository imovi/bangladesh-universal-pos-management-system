import { PrismaClient } from "@prisma/client";
import { execSync } from "child_process";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to reset database in production environment (NODE_ENV=production)");
  }

  const rawUrl =
    process.env.MIGRATION_E2E_DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_e2e?schema=public";

  const parsed = new URL(rawUrl);
  const dbName = parsed.pathname.replace(/^\//, "");

  // Strict guard: MUST end with '_e2e'
  if (!dbName.endsWith("_e2e")) {
    throw new Error(
      `Refusing to setup e2e database '${dbName}': target database name must end in '_e2e'.`,
    );
  }

  console.log(`[db:reset:e2e] Connecting to ${dbName} as admin to drop and recreate schema 'public'...`);

  const adminClient = new PrismaClient({ datasources: { db: { url: rawUrl } } });
  await adminClient.$executeRawUnsafe(`DROP SCHEMA IF EXISTS public CASCADE;`);
  await adminClient.$executeRawUnsafe(`CREATE SCHEMA public;`);
  await adminClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO pos_admin;`);
  await adminClient.$executeRawUnsafe(`GRANT ALL ON SCHEMA public TO pos_runtime;`);
  await adminClient.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO pos_app;`);
  await adminClient.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO pos_system;`);
  await adminClient.$disconnect();

  console.log(`[db:reset:e2e] Deploying migrations...`);
  execSync("npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma", {
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: rawUrl,
      MIGRATION_DATABASE_URL: rawUrl,
    },
  });

  console.log(`[db:reset:e2e] Granting table permissions...`);
  const postMigrateClient = new PrismaClient({ datasources: { db: { url: rawUrl } } });
  await postMigrateClient.$executeRawUnsafe(`GRANT ALL ON ALL TABLES IN SCHEMA public TO pos_admin, pos_runtime;`);
  await postMigrateClient.$executeRawUnsafe(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO pos_admin, pos_runtime;`);
  await postMigrateClient.$disconnect();

  console.log(`[db:reset:e2e] Seeding clean demo dataset...`);
  execSync("npx tsx scripts/seed-demo.ts", {
    stdio: "inherit",
    env: {
      ...process.env,
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET || "test-jwt-access-secret-minimum-32-chars-long",
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET || "test-jwt-refresh-secret-minimum-32-chars-long",
      DATABASE_URL: "postgresql://pos_runtime:pos_runtime_secret@localhost:5432/universal_pos_e2e?schema=public",
      MIGRATION_DATABASE_URL: rawUrl,
    },
  });

  console.log(`[db:reset:e2e] Database '${dbName}' successfully reset and seeded!`);
}

main().catch((err) => {
  console.error(`[db:reset:e2e] Error:`, err.message);
  process.exit(1);
});
