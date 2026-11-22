import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { DailyHealthAlertService } from "./daily-health.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { PERMISSIONS, JwtPayload } from "@universal-pos/shared";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly dailyHealthService: DailyHealthAlertService,
  ) {}

  @Get("daily-health")
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async getDailyHealth(
    @CurrentUser() user: JwtPayload,
    @Query("clientOfflineAgeHours") clientOfflineAgeHours?: string,
  ) {
    const age = clientOfflineAgeHours ? Number(clientOfflineAgeHours) : 0;
    return this.dailyHealthService.evaluateHealth(user.tenantId, age);
  }

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async getAuditLogs(
    @CurrentUser() user: JwtPayload,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("entityType") entityType?: string,
    @Query("action") action?: string,
    @Query("actorUserId") actorUserId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
  ) {
    return this.auditService.findMany(user.tenantId, {
      page,
      limit,
      entityType,
      action,
      actorUserId,
      startDate,
      endDate,
      sortBy,
      sortOrder,
    });
  }
}
