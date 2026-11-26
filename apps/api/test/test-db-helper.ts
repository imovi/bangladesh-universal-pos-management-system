import { PrismaClient } from "@prisma/client";

/**
 * Returns the configured TEST_DATABASE_URL.
 * Connects as the non-superuser pos_runtime.
 */
export function getTestDatabaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ||
    "postgresql://pos_runtime:pos_runtime_secret@localhost:5432/universal_pos_test?schema=public&connection_limit=30"
  );
}

/**
 * Returns the admin/owner migration URL for the test database.
 * Used strictly for setup, teardown (truncate), and catalogue assertions.
 */
export function getTestAdminDatabaseUrl(): string {
  return (
    process.env.MIGRATION_TEST_DATABASE_URL ||
    "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_test?schema=public"
  );
}

/**
 * Validates that a database URL points to a database name ending with '_test'.
 * Refuses execution if it does not to prevent accidental wiping of development data.
 */
export function assertTestDatabase(url: string): void {
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test") && !dbName.endsWith("_e2e")) {
    throw new Error(
      `Refusing to execute destructive operations against database '${dbName}': database name must end in '_test' or '_e2e' to protect the development database.`,
    );
  }
}

/**
 * Truncates tenant data cascading across all tenant tables in the test database.
 * Refuses to run unless the target database ends in '_test'.
 */
export async function truncateTestDatabase(): Promise<void> {
  const adminUrl = getTestAdminDatabaseUrl();
  assertTestDatabase(adminUrl);

  const prisma = new PrismaClient({
    datasources: { db: { url: adminUrl } },
  });

  try {
    await prisma.$connect();
    await prisma.$executeRawUnsafe("TRUNCATE TABLE public.tenants, public.platform_admins CASCADE;");
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Creates a PrismaClient connected to the runtime test database as pos_runtime.
 */
export function createTestPrismaClient(): PrismaClient {
  const url = getTestDatabaseUrl();
  assertTestDatabase(url);
  return new PrismaClient({
    datasources: { db: { url } },
  });
}

/**
 * Creates a PrismaClient connected to the admin test database as pos_admin.
 */
export function createTestAdminPrismaClient(): PrismaClient {
  const url = getTestAdminDatabaseUrl();
  assertTestDatabase(url);
  return new PrismaClient({
    datasources: { db: { url } },
  });
}
