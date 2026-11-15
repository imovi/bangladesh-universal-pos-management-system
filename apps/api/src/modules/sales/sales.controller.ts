import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Res,
  Ip,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { SalesService } from "./sales.service.js";
import {
  PERMISSIONS,
  CreateSaleSchema,
  VoidSaleSchema,
} from "@universal-pos/shared";

@Controller("sales")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @RequirePermission(PERMISSIONS.SALE_CREATE)
  async create(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateSaleSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    const sale = await this.salesService.create(
      req.user.tenantId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
      req.user,
    );

    if ((sale as any).isDuplicate) {
      res.status(HttpStatus.OK);
    }

    return sale;
  }

  @Post(":id/void")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.SALE_VOID)
  async voidSale(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = VoidSaleSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.salesService.voidSale(
      req.user.tenantId,
      id,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.SALE_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.salesService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.SALE_READ)
  async findMany(
    @Req() req: any,
    @Query("branchId") branchId?: string,
    @Query("shiftId") shiftId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.salesService.findMany(req.user.tenantId, {
      branchId,
      shiftId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
