import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Headers,
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
import { ReturnsService } from "./returns.service.js";
import {
  PERMISSIONS,
  CreateSaleSchema,
  VoidSaleSchema,
  CreateSaleReturnSchema,
  CreateSaleExchangeSchema,
  ListReturnsQuerySchema,
  ResolveSaleReviewFlagSchema,
} from "@universal-pos/shared";

@Controller("sales")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly returnsService: ReturnsService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.SALE_CREATE)
  async create(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
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

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required",
      });
    }

    if (parse.data.id !== idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_MISMATCH",
        message: "Idempotency-Key header must match body id",
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

  @Post("exchange")
  @RequirePermission(PERMISSIONS.SALE_RETURN)
  async createExchange(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateSaleExchangeSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required",
      });
    }

    if (parse.data.id !== idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_MISMATCH",
        message: "Idempotency-Key header must match body id",
      });
    }

    const exchange = await this.returnsService.createExchange(
      req.user.tenantId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
      req.user,
    );

    if ((exchange as any).isDuplicate) {
      res.status(HttpStatus.OK);
    }

    return exchange;
  }

  @Post(":id/returns")
  @RequirePermission(PERMISSIONS.SALE_RETURN)
  async createReturn(
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
    @Param("id") saleId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateSaleReturnSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key header is required",
      });
    }

    if (parse.data.id !== idempotencyKey) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_MISMATCH",
        message: "Idempotency-Key header must match body id",
      });
    }

    const result = await this.returnsService.createReturn(
      req.user.tenantId,
      saleId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
      req.user,
    );

    if ((result as any).isDuplicate) {
      res.status(HttpStatus.OK);
    }

    return result;
  }

  @Get("returns")
  @RequirePermission(PERMISSIONS.SALE_RETURN)
  async listReturns(
    @Req() req: any,
    @Query() query: unknown,
  ) {
    const parse = ListReturnsQuerySchema.safeParse(query);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }
    return this.returnsService.findMany(req.user.tenantId, parse.data);
  }

  @Get("returns/:id")
  @RequirePermission(PERMISSIONS.SALE_RETURN)
  async getReturnById(@Req() req: any, @Param("id") id: string) {
    return this.returnsService.findById(req.user.tenantId, id);
  }

  @Get("offline-review/count")
  @RequirePermission(PERMISSIONS.SALE_OFFLINE_REVIEW)
  async getOfflineReviewCount(@Req() req: any) {
    return this.salesService.getOfflineReviewCount(req.user.tenantId);
  }

  @Get("offline-review")
  @RequirePermission(PERMISSIONS.SALE_OFFLINE_REVIEW)
  async listOfflineReview(
    @Req() req: any,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
    @Query("status") status?: string,
    @Query("flag") flag?: string,
    @Query("branchId") branchId?: string,
  ) {
    return this.salesService.getOfflineReviewFlags(req.user.tenantId, {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      status,
      flag,
      branchId,
    });
  }

  @Patch("offline-review/:id/resolve")
  @RequirePermission(PERMISSIONS.SALE_OFFLINE_REVIEW)
  async resolveOfflineReviewFlag(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = ResolveSaleReviewFlagSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.salesService.resolveOfflineReviewFlag(
      req.user.tenantId,
      id,
      parse.data,
      userId,
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
    @Query("cashierId") cashierId?: string,
    @Query("paymentMethod") paymentMethod?: string,
    @Query("search") search?: string,
    @Query("startDate") startDate?: string,
    @Query("endDate") endDate?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.salesService.findMany(req.user.tenantId, {
      branchId,
      shiftId,
      status,
      cashierId,
      paymentMethod,
      search,
      startDate,
      endDate,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
