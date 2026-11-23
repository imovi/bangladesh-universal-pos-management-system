import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import fs from "fs";
import { DailyHealthAlertService } from "../src/modules/audit/daily-health.service.js";

describe("Milestone F5: Daily Health Alert Service", () => {
  let service: DailyHealthAlertService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      shift: {
        count: vi.fn().mockResolvedValue(0),
      },
      saleReviewFlag: {
        count: vi.fn().mockResolvedValue(0),
      },
      tenant: {
        findMany: vi.fn().mockResolvedValue([{ id: "tenant-1", name: "Shop 1" }]),
      },
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(true),
    };

    service = new DailyHealthAlertService(mockPrisma, mockAudit);
  });

  it("detects when backup is missing or overdue", async () => {
    // Missing backup
    const healthMissing = await service.evaluateHealth("tenant-1", 0, "non-existent-backup.json");
    expect(healthMissing.backupOverdue).toBe(true);
    expect(healthMissing.needsAction).toBe(true);
    expect(healthMissing.alerts.some((a) => a.type === "BACKUP_OVERDUE")).toBe(true);
  });

  it("detects when backup status file reports ok: false with failure reason", async () => {
    const tempFile = path.resolve(process.cwd(), "temp-failed-backup.json");
    fs.writeFileSync(
      tempFile,
      JSON.stringify({
        ok: false,
        timestamp: new Date().toISOString(),
        reason: "age অনুপস্থিত অথবা এনক্রিপশন ব্যর্থ হয়েছে",
      })
    );
    try {
      const health = await service.evaluateHealth("tenant-1", 0, tempFile);
      expect(health.needsAction).toBe(true);
      const backupFailedAlert = health.alerts.find((a) => a.type === "BACKUP_FAILED");
      expect(backupFailedAlert).toBeDefined();
      expect(backupFailedAlert?.messageBn).toContain("এনক্রিপশন ব্যর্থ হয়েছে");
    } finally {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
  });

  it("detects shifts left open for more than 16 hours", async () => {
    mockPrisma.shift.count.mockResolvedValue(2);

    const health = await service.evaluateHealth("tenant-1");
    expect(health.openShiftsExceededCount).toBe(2);
    expect(health.needsAction).toBe(true);
    const shiftAlert = health.alerts.find((a) => a.type === "SHIFT_OPEN_EXCEEDED");
    expect(shiftAlert).toBeDefined();
    expect(shiftAlert?.messageEn).toContain("2 shift(s)");
  });

  it("detects pending sale review flags awaiting action", async () => {
    mockPrisma.saleReviewFlag.count.mockResolvedValue(3);

    const health = await service.evaluateHealth("tenant-1");
    expect(health.pendingFlagsCount).toBe(3);
    expect(health.needsAction).toBe(true);
    const flagAlert = health.alerts.find((a) => a.type === "REVIEW_FLAGS_PENDING");
    expect(flagAlert).toBeDefined();
    expect(flagAlert?.messageEn).toContain("3 sale(s)");
  });

  it("scheduled cron writes daily health summary to audit log for all active tenants", async () => {
    await service.runDailyHealthSummary();

    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        action: "DAILY_HEALTH_SUMMARY",
        entityType: "SYSTEM",
        entityId: "DAILY_HEALTH_CHECK",
      })
    );
  });
});
