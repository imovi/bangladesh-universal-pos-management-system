import { FullConfig } from "@playwright/test";

export default async function globalSetup(config: FullConfig) {
  // 1. Guard environment DATABASE_URL if set
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const parsed = new URL(dbUrl);
      const dbName = parsed.pathname.replace(/^\//, "");
      if (!dbName.endsWith("_e2e")) {
        throw new Error(
          `[E2E SAFETY GUARD] Refusing to run E2E tests: DATABASE_URL points to '${dbName}'! E2E tests must only target an database ending in '_e2e' (universal_pos_e2e).`
        );
      }
    } catch (err: any) {
      if (err.message.includes("[E2E SAFETY GUARD]")) throw err;
    }
  }

  // 2. Guard running API backend database connection
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";
  try {
    const res = await fetch(`${apiUrl}/health`);
    if (res.ok) {
      const json = await res.json();
      const dbName = json.data?.databaseName;
      if (dbName && !dbName.endsWith("_e2e")) {
        throw new Error(
          `[E2E SAFETY GUARD] Refusing to run E2E tests: The backend API at ${apiUrl} is connected to '${dbName}'! E2E tests must only run against 'universal_pos_e2e' to prevent dev database test data leakage.`
        );
      }
    }
  } catch (err: any) {
    if (err.message.includes("[E2E SAFETY GUARD]")) throw err;
    // If backend isn't up yet or unreachable, Playwright's webServer / tests will handle connectivity
  }
}
