import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

export interface RestoreOptions {
  backupFile?: string;
  targetDb?: string;
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  backupDir?: string;
  ageSecretKey?: string;
  ageKeyFile?: string;
  container?: string;
}

export interface RestoreResult {
  timestamp: string;
  database: string;
  backupFile: string;
  status: "success" | "failed";
  rowCounts: Record<string, number>;
}

function resolvePgCommand(cmd: string, args: string, host: string, port: number | string, user: string, container?: string): string {
  try {
    execSync(`${cmd} --version`, { stdio: "pipe" });
    return `${cmd} -h ${host} -p ${port} -U ${user} ${args}`;
  } catch {
    const cont = container || process.env.POSTGRES_CONTAINER || "universal_pos_postgres";
    return `docker exec -i ${cont} ${cmd} -U ${user} ${args}`;
  }
}

function executeSqlViaStdin(cmd: string, sql: string, env: Record<string, any>) {
  execSync(cmd, {
    input: Buffer.from(sql, "utf8"),
    env,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

export async function runRestore(options: RestoreOptions = {}): Promise<RestoreResult> {
  const host = options.host || process.env.POSTGRES_HOST || "localhost";
  const port = options.port || process.env.POSTGRES_PORT || 5432;
  const user = options.user || process.env.POSTGRES_USER || "pos_admin";
  const password = options.password || process.env.POSTGRES_PASSWORD || "pos_secret";
  const liveDb = process.env.POSTGRES_DB || "universal_pos";
  const targetDb = options.targetDb || process.env.TARGET_DB || "universal_pos_restore_check";
  const backupDir = options.backupDir || process.env.BACKUP_DIR || path.resolve(process.cwd(), "backups");
  const container = options.container;

  // RESTORE SAFETY RULE: NEVER RESTORE INTO THE LIVE DATABASE
  if (targetDb === liveDb || targetDb === "universal_pos") {
    throw new Error(
      `RESTORE SAFETY VIOLATION: restore script will NEVER restore into live database '${targetDb}'. You must specify a fresh restore database name (e.g. universal_pos_restore_check).`
    );
  }

  // Find backup file
  let backupFile = options.backupFile;
  if (!backupFile) {
    const dailyDir = path.join(backupDir, "daily");
    if (fs.existsSync(dailyDir)) {
      const candidates = fs
        .readdirSync(dailyDir)
        .filter((f) => f.endsWith(".dump") || f.endsWith(".age"))
        .map((f) => ({
          name: f,
          path: path.join(dailyDir, f),
          mtime: fs.statSync(path.join(dailyDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      if (candidates.length > 0) {
        backupFile = candidates[0].path;
      }
    }
  }

  if (!backupFile || !fs.existsSync(backupFile)) {
    throw new Error(`Backup file not found: ${backupFile || "(none specified)"}`);
  }

  console.log(`[RESTORE] Preparing to restore ${path.basename(backupFile)} into isolated database '${targetDb}'...`);

  let dumpToRestore = backupFile;
  let tempDecrypted = false;

  // Decrypt if .age
  if (backupFile.endsWith(".age")) {
    const ageKeyFile = options.ageKeyFile || process.env.BACKUP_AGE_KEY_FILE;
    const ageSecretKey = options.ageSecretKey || process.env.BACKUP_AGE_SECRET_KEY;
    const decryptedPath = backupFile.replace(/\.age$/, "");

    if (ageKeyFile && fs.existsSync(ageKeyFile)) {
      execSync(`age -d -i "${ageKeyFile}" -o "${decryptedPath}" "${backupFile}"`, { stdio: "pipe" });
      dumpToRestore = decryptedPath;
      tempDecrypted = true;
    } else if (ageSecretKey) {
      const tempKey = path.join(backupDir, ".temp_age_key");
      fs.writeFileSync(tempKey, ageSecretKey + "\n", { mode: 0o600 });
      try {
        execSync(`age -d -i "${tempKey}" -o "${decryptedPath}" "${backupFile}"`, { stdio: "pipe" });
        dumpToRestore = decryptedPath;
        tempDecrypted = true;
      } finally {
        if (fs.existsSync(tempKey)) fs.unlinkSync(tempKey);
      }
    } else {
      throw new Error("Encrypted backup detected, but no age private key (BACKUP_AGE_KEY_FILE or BACKUP_AGE_SECRET_KEY) provided.");
    }
  }

  const env = { ...process.env, PGPASSWORD: password };

  try {
    // 1. Drop existing target database if present, and recreate fresh
    console.log(`[RESTORE] Creating fresh database '${targetDb}'...`);
    const dropAndCreateSql = `
      DROP DATABASE IF EXISTS "${targetDb}";
      CREATE DATABASE "${targetDb}" OWNER "${user}";
    `;
    const psqlPostgresCmd = resolvePgCommand("psql", `-d postgres`, host, port, user, container);
    executeSqlViaStdin(psqlPostgresCmd, dropAndCreateSql, env);

    // 2. Restore database content from custom dump
    console.log(`[RESTORE] Executing pg_restore into '${targetDb}'...`);
    try {
      execSync("pg_restore --version", { stdio: "pipe" });
      execSync(
        `pg_restore -h ${host} -p ${port} -U ${user} -d ${targetDb} --no-owner --role=${user} "${dumpToRestore}"`,
        { env, stdio: "pipe" }
      );
    } catch {
      const cont = container || process.env.POSTGRES_CONTAINER || "universal_pos_postgres";
      const dumpBytes = fs.readFileSync(dumpToRestore);
      execSync(`docker exec -i ${cont} pg_restore -U ${user} -d ${targetDb} --no-owner --role=${user}`, {
        input: dumpBytes,
        env,
        maxBuffer: 50 * 1024 * 1024,
      });
    }

    // 3. Ensure runtime user grants are active on restored target database
    const runtimeUser = process.env.POSTGRES_RUNTIME_USER || "pos_runtime";
    const grantSql = `
      GRANT CONNECT ON DATABASE "${targetDb}" TO "${runtimeUser}";
      GRANT USAGE ON SCHEMA public TO "${runtimeUser}", pos_app, pos_system;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pos_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pos_app;
      GRANT SELECT, INSERT ON audit_logs TO pos_app;
      REVOKE UPDATE, DELETE ON audit_logs FROM pos_app;
      GRANT SELECT, INSERT ON loyalty_ledger TO pos_app;
      REVOKE UPDATE, DELETE ON loyalty_ledger FROM pos_app;
    `;
    const psqlTargetCmd = resolvePgCommand("psql", `-d ${targetDb}`, host, port, user, container);
    executeSqlViaStdin(psqlTargetCmd, grantSql, env);

    // 4. Query row counts for core business tables
    console.log(`[RESTORE] Verifying restored table row counts...`);
    const checkDbUrl = `postgresql://${user}:${password}@${host}:${port}/${targetDb}?schema=public`;
    const prisma = new PrismaClient({ datasourceUrl: checkDbUrl });

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

    const rowCounts: Record<string, number> = {};
    for (const table of coreTables) {
      const res: any = await prisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "${table}"`);
      rowCounts[table] = res[0]?.count ?? 0;
    }
    await prisma.$disconnect();

    console.log("\n================ RESTORE ROW COUNT SUMMARY ================");
    for (const [table, count] of Object.entries(rowCounts)) {
      console.log(`  ${table.padEnd(24)}: ${count} rows`);
    }
    console.log("===========================================================\n");

    const result: RestoreResult = {
      timestamp: new Date().toISOString(),
      database: targetDb,
      backupFile: path.basename(backupFile),
      status: "success",
      rowCounts,
    };

    fs.writeFileSync(path.join(backupDir, "last-restore-drill.json"), JSON.stringify(result, null, 2));
    return result;
  } finally {
    if (tempDecrypted && fs.existsSync(dumpToRestore)) {
      fs.unlinkSync(dumpToRestore);
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("restore.ts")) {
  const target = process.argv[2];
  runRestore({ targetDb: target })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[RESTORE FAILED]", err.message);
      process.exit(1);
    });
}
