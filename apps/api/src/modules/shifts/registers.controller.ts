import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { RegistersService } from "./registers.service.js";
import {
  PERMISSIONS,
  CreateRegisterSchema,
  UpdateRegisterSchema,
} from "@universal-pos/shared";

@Controller("registers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RegistersController {
  constructor(private readonly registersService: RegistersService) {}

  @Post()
  @RequirePermission(PERMISSIONS.REGISTER_MANAGE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateRegisterSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.registersService.create(
      req.user.tenantId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.REGISTER_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateRegisterSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.registersService.update(
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
    return this.registersService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  async findMany(@Req() req: any, @Query("branchId") branchId?: string) {
    return this.registersService.findMany(req.user.tenantId, { branchId });
  }
}
