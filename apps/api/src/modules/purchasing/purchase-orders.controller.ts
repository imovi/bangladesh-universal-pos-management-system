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
import { PurchaseOrdersService } from "./purchase-orders.service.js";
import {
  PERMISSIONS,
  CreatePurchaseOrderSchema,
} from "@universal-pos/shared";

@Controller("purchase-orders")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.PURCHASE_MANAGE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreatePurchaseOrderSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.purchaseOrdersService.create(
      req.user.tenantId,
      parse.data,
      req.user.userId,
      ip,
    );
  }

  @Post(":id/status")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PERMISSIONS.PURCHASE_MANAGE)
  async updateStatus(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: { status: string },
    @Ip() ip: string,
  ) {
    if (!body || !body.status) {
      throw new BadRequestException("Status is required");
    }

    return this.purchaseOrdersService.updateStatus(
      req.user.tenantId,
      id,
      body.status,
      req.user.userId,
      ip,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.purchaseOrdersService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findMany(
    @Req() req: any,
    @Query("supplierId") supplierId?: string,
    @Query("branchId") branchId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.purchaseOrdersService.findMany(req.user.tenantId, {
      supplierId,
      branchId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
