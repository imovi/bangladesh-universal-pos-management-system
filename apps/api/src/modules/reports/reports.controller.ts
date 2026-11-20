import { Controller, Get, Param, Query, UseGuards, Request } from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { PERMISSIONS } from "@universal-pos/shared";
import { ReportsService, type ReportDateFilter } from "./reports.service.js";

@Controller("reports")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get("sales-summary")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getSalesSummary(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getSalesSummary(req.user.tenantId, query);
  }

  @Get("sales-by-variant")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getSalesByVariant(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getSalesByVariant(req.user.tenantId, query);
  }

  @Get("sales-by-category")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getSalesByCategory(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getSalesByCategory(req.user.tenantId, query);
  }

  @Get("sales-by-brand")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getSalesByBrand(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getSalesByBrand(req.user.tenantId, query);
  }

  @Get("sales-by-collection")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getSalesByCollection(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getSalesByCollection(req.user.tenantId, query);
  }

  @Get("variant-matrix")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getVariantMatrix(
    @Request() req: any,
    @Query("productId") productId: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.reportsService.getVariantMatrix(req.user.tenantId, { productId, branchId });
  }

  @Get("profit")
  @RequirePermission(PERMISSIONS.REPORT_PROFIT)
  async getProfitReport(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getProfitReport(req.user.tenantId, query);
  }

  @Get("stock-valuation")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getStockValuation(@Request() req: any, @Query("branchId") branchId?: string) {
    return this.reportsService.getStockValuation(req.user.tenantId, { branchId });
  }

  @Get("shift/:id")
  @RequirePermission(PERMISSIONS.SHIFT_MANAGE)
  async getShiftReport(@Request() req: any, @Param("id") id: string) {
    return this.reportsService.getShiftReport(req.user.tenantId, id);
  }

  @Get("due")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getDueReport(@Request() req: any, @Query("branchId") branchId?: string) {
    return this.reportsService.getDueReport(req.user.tenantId, { branchId });
  }

  @Get("returns")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getReturnsReport(
    @Request() req: any,
    @Query() query: ReportDateFilter & { reason?: string; condition?: string; productId?: string },
  ) {
    return this.reportsService.getReturnsReport(req.user.tenantId, query);
  }

  @Get("damaged-stock")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getDamagedStockReport(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getDamagedStockReport(req.user.tenantId, query);
  }

  @Get("promotions")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getPromotionsReport(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getPromotionsReport(req.user.tenantId, query);
  }

  @Get("loyalty")
  @RequirePermission(PERMISSIONS.REPORT_SALES)
  async getLoyaltyReport(@Request() req: any, @Query() query: ReportDateFilter) {
    return this.reportsService.getLoyaltyReport(req.user.tenantId, query);
  }
}
