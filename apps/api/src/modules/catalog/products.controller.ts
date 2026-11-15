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
import { ProductsService } from "./products.service.js";
import {
  PERMISSIONS,
  CreateProductSchema,
  UpdateProductSchema,
  BulkPriceUpdateSchema,
} from "@universal-pos/shared";

function maskCostField(product: any, canViewCost: boolean) {
  if (!product) return product;
  const clone = JSON.parse(JSON.stringify(product, (_key, val) =>
    typeof val === "bigint" ? Number(val) : val,
  ));

  if (!canViewCost && clone.variants) {
    for (const v of clone.variants) {
      delete v.costMinor;
    }
  }
  return clone;
}

@Controller("products")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async create(@Req() req: any, @Body() body: unknown, @Ip() ip: string) {
    const parse = CreateProductSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid product input",
        details: parse.error.flatten(),
      });
    }

    const tenantId = req.user.tenantId;
    const product = await this.productsService.create(
      tenantId,
      parse.data,
      req.user.id,
      ip,
    );
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);
    return maskCostField(product, canViewCost);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any, @Query() query: any) {
    const tenantId = req.user.tenantId;
    const result = await this.productsService.findAll(tenantId, query);
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);

    return {
      items: result.items.map((p: any) => maskCostField(p, canViewCost)),
      pagination: result.pagination,
    };
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findOne(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const product = await this.productsService.findOne(tenantId, id);
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);
    return maskCostField(product, canViewCost);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateProductSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid product update input",
        details: parse.error.flatten(),
      });
    }

    const tenantId = req.user.tenantId;
    const updated = await this.productsService.update(
      tenantId,
      id,
      parse.data,
      req.user.id,
      ip,
    );
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);
    return maskCostField(updated, canViewCost);
  }

  @Patch(":id/variants/bulk-price")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async bulkUpdatePrices(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = BulkPriceUpdateSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid bulk price update input",
        details: parse.error.flatten(),
      });
    }

    const tenantId = req.user.tenantId;
    return this.productsService.bulkUpdatePrices(
      tenantId,
      id,
      parse.data,
      req.user.id,
      ip,
    );
  }
}
