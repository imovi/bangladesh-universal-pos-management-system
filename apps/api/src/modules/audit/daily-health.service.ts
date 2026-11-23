import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import fs from "fs";
import path from "path";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "./audit.service.js";

export interface SystemHealthAlerts {
  needsAction: boolean;
  backupOverdue: boolean;
  backupAgeHours: number | null;
  openShiftsExceededCount: number;
  pendingFlagsCount: number;
  unsyncedOfflineExceededCount: number;
  alerts: Array<{
    type: "BACKUP_OVERDUE" | "BACKUP_FAILED" | "SHIFT_OPEN_EXCEEDED" | "REVIEW_FLAGS_PENDING" | "OFFLINE_SYNC_OVERDUE";
    severity: "critical" | "warning";
    messageEn: string;
    messageBn: string;
    details?: any;
  }>;
}

@Injectable()
export class DailyHealthAlertService {
  private readonly logger = new Logger(DailyHealthAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Evaluates operational health metrics for a specific tenant.
   */
  async evaluateHealth(
    tenantId: string,
    clientOfflineAgeHours = 0,
    overrideBackupPath?: string,
  ): Promise<SystemHealthAlerts> {
    const alerts: SystemHealthAlerts["alerts"] = [];

    // 1. Check last backup age (> 26 hours)
    let backupAgeHours: number | null = null;
    let backupOverdue = false;
    const backupMetadataPaths = overrideBackupPath
      ? [path.resolve(overrideBackupPath)]
      : [
          ...(process.env.BACKUP_DIR ? [path.resolve(process.env.BACKUP_DIR, "last-backup.json")] : []),
          path.resolve(process.cwd(), "last-backup.json"),
          path.resolve(process.cwd(), "backups", "last-backup.json"),
          path.resolve(process.cwd(), "temp-drill-backups", "last-backup.json"),
        ];

    let foundMetadata = false;
    for (const p of backupMetadataPaths) {
      if (fs.existsSync(p)) {
        try {
          const raw = JSON.parse(fs.readFileSync(p, "utf8"));
          if (raw.ok === false) {
            backupOverdue = true;
            alerts.push({
              type: "BACKUP_FAILED",
              severity: "critical",
              messageEn: `Last backup failed: ${raw.reason || raw.error || "Backup failed"}`,
              messageBn: `সর্বশেষ ব্যাকআপ ব্যর্থ হয়েছে: ${raw.reason || raw.error || "ব্যাকআপ ব্যর্থ হয়েছে"}`,
              details: { reason: raw.reason, error: raw.error },
            });
          }
          if (raw.timestamp) {
            const backupDate = new Date(raw.timestamp).getTime();
            backupAgeHours = Math.round((Date.now() - backupDate) / (1000 * 60 * 60));
            foundMetadata = true;
            if (backupAgeHours > 26) {
              backupOverdue = true;
            }
          }
        } catch {
          // ignore read error
        }
        break;
      }
    }

    if (!foundMetadata || backupOverdue) {
      backupOverdue = true;
      alerts.push({
        type: "BACKUP_OVERDUE",
        severity: "critical",
        messageEn: `Last backup is older than 26 hours (${backupAgeHours !== null ? `${backupAgeHours}h ago` : "No backup record found"})`,
        messageBn: `সর্বশেষ ব্যাকআপ ২৬ ঘণ্টার বেশি পুরোনো (${backupAgeHours !== null ? `${backupAgeHours} ঘণ্টা আগে` : "কোনো ব্যাকআপ পাওয়া যায়নি"})`,
        details: { backupAgeHours },
      });
    }

    // 2. Shifts left open for more than 16 hours
    const sixteenHoursAgo = new Date(Date.now() - 16 * 60 * 60 * 1000);
    const openShiftsExceeded = await this.prisma.shift.count({
      where: {
        tenantId,
        status: "open",
        openedAt: { lt: sixteenHoursAgo },
      },
    });

    if (openShiftsExceeded > 0) {
      alerts.push({
        type: "SHIFT_OPEN_EXCEEDED",
        severity: "warning",
        messageEn: `${openShiftsExceeded} shift(s) have been left open for more than 16 hours`,
        messageBn: `${openShiftsExceeded}টি শিফট ১৬ ঘণ্টার বেশি সময় ধরে খোলা রয়েছে`,
        details: { count: openShiftsExceeded },
      });
    }

    // 3. Sales with review flags waiting (PRICE_CHANGED, PROMOTION_CHANGED, RETURN_REJECTED)
    const pendingFlags = await this.prisma.saleReviewFlag.count({
      where: {
        tenantId,
        status: "PENDING",
      },
    });

    if (pendingFlags > 0) {
      alerts.push({
        type: "REVIEW_FLAGS_PENDING",
        severity: "warning",
        messageEn: `${pendingFlags} sale(s) have pending review flags awaiting owner action`,
        messageBn: `${pendingFlags}টি বিক্রয়ে পর্যালোচনা ফ্ল্যাগ পর্যালোচনার অপেক্ষায় রয়েছে`,
        details: { count: pendingFlags },
      });
    }

    // 4. Unsynced offline sales older than 24 hours (reported by client heartbeat or cached)
    let unsyncedOfflineExceededCount = 0;
    if (clientOfflineAgeHours > 24) {
      unsyncedOfflineExceededCount = 1;
      alerts.push({
        type: "OFFLINE_SYNC_OVERDUE",
        severity: "critical",
        messageEn: `Unsynced offline sales older than 24 hours detected on register terminal`,
        messageBn: `টার্মিনালে ২৪ ঘণ্টার বেশি পুরোনো সিঙ্ক না হওয়া অফলাইন বিক্রয় রয়েছে`,
        details: { clientOfflineAgeHours },
      });
    }

    return {
      needsAction: alerts.length > 0,
      backupOverdue,
      backupAgeHours,
      openShiftsExceededCount: openShiftsExceeded,
      pendingFlagsCount: pendingFlags,
      unsyncedOfflineExceededCount,
      alerts,
    };
  }

  /**
   * Daily scheduled cron at 23:30 Asia/Dhaka.
   * Evaluates all active tenants and writes health summary to audit log.
   */
  @Cron("30 23 * * *", { timeZone: "Asia/Dhaka" })
  async runDailyHealthSummary(): Promise<void> {
    this.logger.log("Running scheduled daily health summary at 23:30 Asia/Dhaka...");

    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { status: "active" },
        select: { id: true, name: true },
      });

      for (const tenant of tenants) {
        const health = await this.evaluateHealth(tenant.id);

        await this.auditService.log({
          tenantId: tenant.id,
          action: "DAILY_HEALTH_SUMMARY",
          entityType: "SYSTEM",
          entityId: "DAILY_HEALTH_CHECK",
          after: {
            backupOverdue: health.backupOverdue,
            backupAgeHours: health.backupAgeHours,
            openShiftsExceededCount: health.openShiftsExceededCount,
            pendingFlagsCount: health.pendingFlagsCount,
            needsAction: health.needsAction,
            alertTypes: health.alerts.map((a) => a.type),
            evaluatedAt: new Date().toISOString(),
          },
        });
      }
      this.logger.log(`Daily health summary completed for ${tenants.length} tenants.`);
    } catch (err: any) {
      this.logger.error(`Daily health summary failed: ${err.message}`, err.stack);
    }
  }
}
