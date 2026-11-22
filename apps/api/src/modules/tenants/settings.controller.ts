import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import fs from "fs";
import path from "path";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { TenantsService } from "./tenants.service.js";
import { PERMISSIONS, SYSTEM_ROLES, UpdateTenantSettingsSchema } from "@universal-pos/shared";

@Controller("settings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get("backups")
  @RequirePermission(PERMISSIONS.TENANT_READ)
  async getBackupsStatus(@Req() req: any) {
    if (req.user.roleName !== SYSTEM_ROLES.OWNER) {
      throw new ForbiddenException("Only Owner can view backup status");
    }
    const backupDir =
      process.env.BACKUP_DIR || path.resolve(process.cwd(), "backups");
    let lastBackup: any = null;
    const lastBackupFile = path.join(backupDir, "last-backup.json");
    if (fs.existsSync(lastBackupFile)) {
      try {
        lastBackup = JSON.parse(fs.readFileSync(lastBackupFile, "utf8"));
      } catch {}
    }

    let lastRestoreDrill: any = null;
    const lastRestoreDrillFile = path.join(backupDir, "last-restore-drill.json");
    if (fs.existsSync(lastRestoreDrillFile)) {
      try {
        lastRestoreDrill = JSON.parse(
          fs.readFileSync(lastRestoreDrillFile, "utf8"),
        );
      } catch {}
    }

    const rcloneRemote = process.env.BACKUP_RCLONE_REMOTE;
    const offServerConfigured = Boolean(
      rcloneRemote || lastBackup?.offServerConfigured,
    );
    const offServerWarning = offServerConfigured
      ? null
      : "ব্যাকআপ শুধু এই সার্ভারে আছে";

    return {
      lastBackupAt: lastBackup?.timestamp ?? null,
      lastBackupSizeBytes: lastBackup?.sizeBytes ?? null,
      lastBackupFilename: lastBackup?.filename ?? null,
      encrypted: lastBackup?.encrypted ?? false,
      offServerConfigured,
      offServerWarning,
      lastRestoreDrillAt: lastRestoreDrill?.timestamp ?? null,
      lastRestoreDrillStatus: lastRestoreDrill?.status ?? null,
    };
  }

  @Get("pos")
  @RequirePermission(PERMISSIONS.SALE_CREATE)
  async getPosSettings(@Req() req: any) {
    const data = await this.tenantsService.getSettings(req.user.tenantId);
    const s = (data.settings as Record<string, any>) || {};
    return {
      shopName: data.name,
      currency: (s.currency as string) ?? "BDT",
      timezone: (s.timezone as string) ?? "Asia/Dhaka",
      pricesIncludeTax: Boolean(s.prices_include_tax ?? false),
      allowNegativeStock: Boolean(s.allow_negative_stock ?? false),
      receiptHeader: (s.receipt_header as string) ?? "",
      receiptFooter: (s.receipt_footer as string) ?? "",
    };
  }

  @Get()
  @RequirePermission(PERMISSIONS.TENANT_READ)
  async getSettings(@Req() req: any) {
    return this.tenantsService.getSettings(req.user.tenantId);
  }

  @Patch()
  @RequirePermission(PERMISSIONS.TENANT_UPDATE)
  async updateSettings(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateTenantSettingsSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    const { name, ...settings } = parse.data;
    const actorUserId = req.user.sub || req.user.userId || req.user.id;
    return this.tenantsService.updateSettings(
      req.user.tenantId,
      settings,
      name,
      actorUserId,
      ip,
    );
  }
}
