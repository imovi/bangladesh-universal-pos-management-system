import {
  Controller,
  Get,
  Post,
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
import { InventoryService } from "./inventory.service.js";
import {
  PERMISSIONS,
  BulkOpeningStockSchema,
  StockAdjustmentSchema,
} from "@universal-pos/shared";

@Controller("inventory")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post("opening-stock")
  @RequirePermission(PERMISSIONS.INVENTORY_MANAGE)
  async createOpeningStock(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = BulkOpeningStockSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.inventoryService.createOpeningStock(
      req.user.tenantId,
      parse.data,
      req.user.userId,
      ip,
    );
  }

  @Post("adjustment")
  @RequirePermission(PERMISSIONS.STOCK_ADJUST)
  async adjustStock(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = StockAdjustmentSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.inventoryService.adjustStock(
      req.user.tenantId,
      parse.data,
      req.user.userId,
      ip,
    );
  }

  @Get("levels")
  @RequirePermission(PERMISSIONS.INVENTORY_READ)
  async getStockLevels(
    @Req() req: any,
    @Query("branchId") branchId?: string,
    @Query("variantId") variantId?: string,
    @Query("search") search?: string,
    @Query("lowStock") lowStock?: string,
    @Query("negative") negative?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.inventoryService.getStockLevels(req.user.tenantId, {
      branchId,
      variantId,
      search,
      lowStock: lowStock === "true",
      negative: negative === "true",
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("low-stock")
  @RequirePermission(PERMISSIONS.INVENTORY_READ)
  async getLowStock(
    @Req() req: any,
    @Query("branchId") branchId?: string,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.inventoryService.getStockLevels(req.user.tenantId, {
      branchId,
      search,
      lowStock: true,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get("movements")
  @RequirePermission(PERMISSIONS.INVENTORY_READ)
  async getMovements(
    @Req() req: any,
    @Query("branchId") branchId?: string,
    @Query("variantId") variantId?: string,
    @Query("type") type?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.inventoryService.getMovements(req.user.tenantId, {
      branchId,
      variantId,
      type,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
