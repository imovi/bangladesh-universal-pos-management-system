import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import { PERMISSIONS, JwtPayload } from "@universal-pos/shared";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async getAuditLogs(
    @CurrentUser() user: JwtPayload,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("entityType") entityType?: string,
    @Query("actorUserId") actorUserId?: string,
  ) {
    return this.auditService.findMany(user.tenantId, {
      page,
      limit,
      entityType,
      actorUserId,
    });
  }
}
