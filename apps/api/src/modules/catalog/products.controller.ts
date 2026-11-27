import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { ModuleGuard } from "../../common/guards/module.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { RequireModule } from "../../common/decorators/require-module.decorator.js";
import { ProductsService } from "./products.service.js";
import { UnitsService } from "./units.service.js";
import { ModulesService } from "../modules/modules.service.js";
import {
  PERMISSIONS,
  CreateProductSchema,
  UpdateProductSchema,
  BulkPriceUpdateSchema,
  CreateProductUnitSchema,
  UpdateProductUnitSchema,
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
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly unitsService: UnitsService,
    private readonly modulesService: ModulesService,
  ) {}

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

    // Check if non-default unit fields are sent when units module is disabled
    const hasNonDefaultUnitFields =
      (parse.data.baseUnit && parse.data.baseUnit !== "pcs") ||
      parse.data.allowDecimalQty === true ||
      Boolean((body as any)?.units && (body as any).units.length > 0) ||
      Boolean((body as any)?.productUnitId);

    if (hasNonDefaultUnitFields) {
      const isUnitsActive = await this.modulesService.isModuleActiveForTenant(tenantId, "units");
      if (!isUnitsActive) {
        throw new ForbiddenException({
          code: "MODULE_DISABLED",
          message: "এই বৈশিষ্ট্যের জন্য 'পরিমাপের একক ও রূপান্তর' মডিউলটি চালু থাকতে হবে।",
        });
      }
    }

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

    // Check if non-default unit fields are sent when units module is disabled
    const hasNonDefaultUnitFields =
      (parse.data.baseUnit !== undefined && parse.data.baseUnit !== "pcs") ||
      parse.data.allowDecimalQty === true ||
      Boolean((body as any)?.units && (body as any).units.length > 0) ||
      Boolean((body as any)?.productUnitId);

    if (hasNonDefaultUnitFields) {
      const isUnitsActive = await this.modulesService.isModuleActiveForTenant(tenantId, "units");
      if (!isUnitsActive) {
        throw new ForbiddenException({
          code: "MODULE_DISABLED",
          message: "এই বৈশিষ্ট্যের জন্য 'পরিমাপের একক ও রূপান্তর' মডিউলটি চালু থাকতে হবে।",
        });
      }
    }

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

  @Get(":id/units")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async listUnits(@Req() req: any, @Param("id") id: string) {
    return this.unitsService.listUnits(req.user.tenantId, id);
  }

  @Post(":id/units")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async createUnit(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateProductUnitSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid product unit input",
        details: parse.error.flatten(),
      });
    }

    return this.unitsService.createUnit(
      req.user.tenantId,
      id,
      parse.data,
      req.user.id,
      ip,
    );
  }

  @Patch(":id/units/:unitId")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async updateUnit(
    @Req() req: any,
    @Param("id") id: string,
    @Param("unitId") unitId: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateProductUnitSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid product unit input",
        details: parse.error.flatten(),
      });
    }

    return this.unitsService.updateUnit(
      req.user.tenantId,
      id,
      unitId,
      parse.data,
      req.user.id,
      ip,
    );
  }

  @Delete(":id/units/:unitId")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async deactivateUnit(
    @Req() req: any,
    @Param("id") id: string,
    @Param("unitId") unitId: string,
    @Ip() ip: string,
  ) {
    return this.unitsService.deactivateUnit(
      req.user.tenantId,
      id,
      unitId,
      req.user.id,
      ip,
    );
  }
}
