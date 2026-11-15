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
import { SupplierPaymentsService } from "./supplier-payments.service.js";
import {
  PERMISSIONS,
  CreateSupplierPaymentSchema,
} from "@universal-pos/shared";

@Controller("supplier-payments")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupplierPaymentsController {
  constructor(
    private readonly supplierPaymentsService: SupplierPaymentsService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.PURCHASE_MANAGE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateSupplierPaymentSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.supplierPaymentsService.create(
      req.user.tenantId,
      parse.data,
      req.user.userId,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.PURCHASE_READ)
  async findMany(
    @Req() req: any,
    @Query("supplierId") supplierId?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.supplierPaymentsService.findMany(req.user.tenantId, {
      supplierId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
