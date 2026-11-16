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
import { SuppliersService } from "./suppliers.service.js";
import {
  PERMISSIONS,
  CreateSupplierSchema,
  UpdateSupplierSchema,
} from "@universal-pos/shared";

@Controller("suppliers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Post()
  @RequirePermission(PERMISSIONS.PURCHASE_MANAGE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateSupplierSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.suppliersService.create(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.PURCHASE_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateSupplierSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.suppliersService.update(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get(":id/balance")
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async getBalance(@Req() req: any, @Param("id") id: string) {
    return this.suppliersService.getBalance(req.user.tenantId, id);
  }

  @Get(":id/statement")
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async getStatement(
    @Req() req: any,
    @Param("id") id: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.suppliersService.getStatement(req.user.tenantId, id, {
      startDate,
      endDate,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.suppliersService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findMany(
    @Req() req: any,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.suppliersService.findMany(req.user.tenantId, {
      search,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
