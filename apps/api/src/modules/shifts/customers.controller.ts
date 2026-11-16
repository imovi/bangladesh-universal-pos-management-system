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
import { CustomersService } from "./customers.service.js";
import {
  PERMISSIONS,
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from "@universal-pos/shared";

@Controller("customers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CUSTOMER_MANAGE)
  async create(
    @Req() req: any,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateCustomerSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.customersService.create(
      req.user.tenantId,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CUSTOMER_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateCustomerSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.customersService.update(
      req.user.tenantId,
      id,
      parse.data,
      req.user.sub || req.user.userId || req.user.id,
      ip,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.customersService.findById(req.user.tenantId, id);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CUSTOMER_READ)
  async findMany(
    @Req() req: any,
    @Query("search") search?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.customersService.findMany(req.user.tenantId, {
      search,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
