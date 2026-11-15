import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Ip,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { ShiftsService } from "./shifts.service.js";
import {
  PERMISSIONS,
  OpenShiftSchema,
  CloseShiftSchema,
  CashMovementSchema,
} from "@universal-pos/shared";

@Controller("shifts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post("open")
  @RequirePermission(PERMISSIONS.SHIFT_OPEN)
  async open(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = OpenShiftSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.shiftsService.open(
      req.user.tenantId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Post(":id/cash-movements")
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  async addCashMovement(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CashMovementSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.shiftsService.addCashMovement(
      req.user.tenantId,
      id,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Post(":id/close")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.SHIFT_CLOSE)
  async close(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CloseShiftSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.shiftsService.close(
      req.user.tenantId,
      id,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.shiftsService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  async findMany(
    @Req() req: any,
    @Query("registerId") registerId?: string,
    @Query("branchId") branchId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.shiftsService.findMany(req.user.tenantId, {
      registerId,
      branchId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
