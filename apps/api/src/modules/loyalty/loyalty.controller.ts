import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  Req,
  Ip,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { PERMISSIONS } from "@universal-pos/shared";
import {
  UpdateLoyaltySettingsSchema,
  AdjustLoyaltyPointsSchema,
  LoyaltyLedgerQuerySchema,
} from "@universal-pos/shared";
import { LoyaltyService } from "./loyalty.service.js";

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Get("settings/loyalty")
  @RequirePermission(PERMISSIONS.TENANT_READ)
  async getSettings(@Req() req: any) {
    return this.loyaltyService.getSettings(req.user.tenantId);
  }

  @Patch("settings/loyalty")
  @RequirePermission(PERMISSIONS.LOYALTY_MANAGE)
  async updateSettings(
    @Req() req: any,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const parse = UpdateLoyaltySettingsSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid loyalty settings input",
        errors: parse.error.flatten(),
      });
    }
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.loyaltyService.updateSettings(
      req.user.tenantId,
      userId,
      parse.data,
      ip,
    );
  }

  @Get("customers/:id/loyalty/ledger")
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  async getLedger(
    @Req() req: any,
    @Param("id") customerId: string,
    @Query() query: any,
  ) {
    const parse = LoyaltyLedgerQuerySchema.safeParse(query);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        errors: parse.error.flatten(),
      });
    }
    return this.loyaltyService.getLedger(
      req.user.tenantId,
      customerId,
      parse.data,
    );
  }

  @Post("customers/:id/loyalty/adjust")
  @RequirePermission(PERMISSIONS.LOYALTY_ADJUST)
  @HttpCode(HttpStatus.OK)
  async adjustPoints(
    @Req() req: any,
    @Param("id") customerId: string,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const parse = AdjustLoyaltyPointsSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid points adjustment input",
        errors: parse.error.flatten(),
      });
    }
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.loyaltyService.adjustPoints(
      req.user.tenantId,
      userId,
      customerId,
      parse.data,
      ip,
    );
  }

  @Post("loyalty/expire-job")
  @RequirePermission(PERMISSIONS.LOYALTY_MANAGE)
  @HttpCode(HttpStatus.OK)
  async triggerExpiryJob(@Req() req: any, @Body() body: any) {
    const date = body?.targetDate ? new Date(body.targetDate) : undefined;
    const tenantId = req.user?.tenantId;
    return this.loyaltyService.expirePointsDaily(date, tenantId);
  }
}
