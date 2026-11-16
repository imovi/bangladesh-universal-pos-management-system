import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { TenantsService } from "./tenants.service.js";
import { PERMISSIONS, UpdateTenantSettingsSchema } from "@universal-pos/shared";

@Controller("settings")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly tenantsService: TenantsService) {}

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
