import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";

export interface BackupOptions {
  host?: string;
  port?: number | string;
  user?: string;
  password?: string;
  database?: string;
  backupDir?: string;
  agePublicKey?: string;
  rcloneRemote?: string;
  container?: string;
}

export interface BackupResult {
  timestamp: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  encrypted: boolean;
  offServerConfigured: boolean;
  offServerWarning: string | null;
  checksum: string;
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

export function runBackup(options: BackupOptions = {}): BackupResult {
  const host = options.host || process.env.POSTGRES_HOST || "localhost";
  const port = options.port || process.env.POSTGRES_PORT || 5432;
  const user = options.user || process.env.POSTGRES_USER || "pos_admin";
  const password = options.password || process.env.POSTGRES_PASSWORD || "pos_secret";
  const database = options.database || process.env.POSTGRES_DB || "universal_pos";
  const backupDir = options.backupDir || process.env.BACKUP_DIR || path.resolve(process.cwd(), "backups");
  const agePublicKey = options.agePublicKey || process.env.BACKUP_AGE_PUBLIC_KEY;
  const rcloneRemote = options.rcloneRemote || process.env.BACKUP_RCLONE_REMOTE;
  const container = options.container;

  const dailyDir = path.join(backupDir, "daily");
  const weeklyDir = path.join(backupDir, "weekly");
  fs.mkdirSync(dailyDir, { recursive: true });
  fs.mkdirSync(weeklyDir, { recursive: true });

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

  const baseName = `backup_${database}_${timestamp}`;
  const dumpFile = path.join(dailyDir, `${baseName}.dump`);
  const globalsFile = path.join(dailyDir, `globals_${timestamp}.sql`);

  console.log(`[BACKUP] Starting backup for database '${database}' at ${now.toISOString()}...`);

  const env = { ...process.env, PGPASSWORD: password };

  // 1. Dump globals (roles and server-level configuration)
  try {
    const globalsCmd = resolvePgCommand("pg_dumpall", "--globals-only", host, port, user, container);
    const globalsSql = execSync(globalsCmd, { env, maxBuffer: 10 * 1024 * 1024 });
    fs.writeFileSync(globalsFile, globalsSql);
  } catch (err: any) {
    fs.writeFileSync(globalsFile, `-- pg_dumpall fallback for ${user} at ${now.toISOString()}\n`);
  }

  // 2. Dump database in custom format (-Fc)
  const hasNativePgDump = (() => {
    try {
      execSync("pg_dump --version", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();

  let dumpData: Buffer;
  if (hasNativePgDump) {
    dumpData = execSync(`pg_dump -h ${host} -p ${port} -U ${user} -d ${database} --format=custom`, {
      env,
      maxBuffer: 50 * 1024 * 1024,
    });
  } else {
    const cont = container || process.env.POSTGRES_CONTAINER || "universal_pos_postgres";
    dumpData = execSync(`docker exec -i ${cont} pg_dump -U ${user} -d ${database} --format=custom`, {
      env,
      maxBuffer: 50 * 1024 * 1024,
    });
  }
  fs.writeFileSync(dumpFile, dumpData);

  let finalFile = dumpFile;
  let isEncrypted = false;

  // 3. Encrypt with age if public key provided and age CLI is installed
  if (agePublicKey) {
    try {
      execSync("age --version", { stdio: "pipe" });
      const encryptedFile = `${dumpFile}.age`;
      execSync(`age -r "${agePublicKey}" -o "${encryptedFile}" "${dumpFile}"`, { stdio: "pipe" });
      fs.unlinkSync(dumpFile);
      finalFile = encryptedFile;
      isEncrypted = true;
      console.log(`[BACKUP] File successfully encrypted with age.`);
    } catch {
      console.warn(`[WARNING] age CLI not available; saving unencrypted backup.`);
    }
  }

  // 4. Compute SHA-256 Checksum
  const fileBuffer = fs.readFileSync(finalFile);
  const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  fs.writeFileSync(`${finalFile}.sha256`, `${checksum}  ${path.basename(finalFile)}\n`);

  const stat = fs.statSync(finalFile);
  const sizeBytes = stat.size;

  // 5. Weekly retention: if Sunday (0), copy to weekly directory
  if (now.getDay() === 0) {
    const weeklyCopy = path.join(weeklyDir, path.basename(finalFile));
    fs.copyFileSync(finalFile, weeklyCopy);
    if (fs.existsSync(`${finalFile}.sha256`)) {
      fs.copyFileSync(`${finalFile}.sha256`, `${weeklyCopy}.sha256`);
    }
  }

  // 6. Prune old backups (keep 14 daily, 8 weekly)
  pruneDirectory(dailyDir, 14);
  pruneDirectory(weeklyDir, 8);

  // 7. Off-server copy via rclone
  const offServerConfigured = Boolean(rcloneRemote);
  const offServerWarning = offServerConfigured ? null : "ব্যাকআপ শুধু এই সার্ভারে আছে";

  if (offServerConfigured) {
    try {
      execSync(`rclone copy "${finalFile}" "${rcloneRemote}"`, { stdio: "pipe" });
      console.log(`[BACKUP] Successfully copied backup to remote '${rcloneRemote}'.`);
    } catch (err: any) {
      console.error(`[BACKUP ERROR] Failed to copy to rclone remote: ${err.message}`);
    }
  } else {
    console.warn(`[WARNING] BACKUP_RCLONE_REMOTE not configured! ${offServerWarning}`);
  }

  // 8. Record last-backup.json metadata
  const result: BackupResult = {
    timestamp: now.toISOString(),
    filename: path.basename(finalFile),
    filePath: finalFile,
    sizeBytes,
    encrypted: isEncrypted,
    offServerConfigured,
    offServerWarning,
    checksum,
  };

  fs.writeFileSync(path.join(backupDir, "last-backup.json"), JSON.stringify(result, null, 2));
  console.log(`[BACKUP] Backup completed: ${result.filename} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);

  return result;
}

function pruneDirectory(dir: string, keepCount: number) {
  if (!fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".dump") || f.endsWith(".age") || f.endsWith(".tar"))
    .map((f) => ({
      name: f,
      path: path.join(dir, f),
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  if (files.length > keepCount) {
    const toDelete = files.slice(keepCount);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(f.path);
        if (fs.existsSync(`${f.path}.sha256`)) {
          fs.unlinkSync(`${f.path}.sha256`);
        }
        console.log(`[BACKUP RETENTION] Pruned old backup: ${f.name}`);
      } catch {}
    }
  }
}

if (process.argv[1] && process.argv[1].endsWith("backup.ts")) {
  runBackup();
}
