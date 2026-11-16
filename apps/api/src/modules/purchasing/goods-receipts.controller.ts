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
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { GoodsReceiptsService } from "./goods-receipts.service.js";
import {
  PERMISSIONS,
  CreateGoodsReceiptSchema,
} from "@universal-pos/shared";

@Controller("goods-receipts")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class GoodsReceiptsController {
  constructor(
    private readonly goodsReceiptsService: GoodsReceiptsService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.PURCHASE_RECEIVE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateGoodsReceiptSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.goodsReceiptsService.create(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findMany(
    @Req() req: any,
    @Query("supplierId") supplierId?: string,
    @Query("purchaseOrderId") purchaseOrderId?: string,
    @Query("branchId") branchId?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.goodsReceiptsService.findMany(req.user.tenantId, {
      supplierId,
      purchaseOrderId,
      branchId,
      startDate,
      endDate,
      search,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.goodsReceiptsService.findById(req.user.tenantId, id);
  }
}
