import {
  Controller,
  Get,
  Post,
  Put,
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
import { VariantsService } from "./variants.service.js";
import { UnitsService } from "./units.service.js";
import { ModulesService } from "../modules/modules.service.js";
import {
  PERMISSIONS,
  CreateBarcodeSchema,
  UpdateVariantSchema,
  SetVariantUnitPriceSchema,
} from "@universal-pos/shared";

@Controller("variants")
@UseGuards(JwtAuthGuard, PermissionsGuard, ModuleGuard)
export class VariantsController {
  constructor(
    private readonly variantsService: VariantsService,
    private readonly unitsService: UnitsService,
    private readonly modulesService: ModulesService,
  ) {}

  @Get("lookup")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async lookup(@Req() req: any, @Query("code") code: string) {
    const tenantId = req.user.tenantId;
    const variant = await this.variantsService.lookup(tenantId, code);
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);

    const clone = JSON.parse(
      JSON.stringify(variant, (_key, val) =>
        typeof val === "bigint" ? Number(val) : val,
      ),
    );

    if (!canViewCost) {
      delete clone.costMinor;
    }
    return clone;
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    const tenantId = req.user.tenantId;
    const variant = await this.variantsService.findById(tenantId, id);
    const canViewCost =
      req.user.isOwner ||
      req.user.permissions.includes(PERMISSIONS.CATALOG_MANAGE);

    const clone = JSON.parse(
      JSON.stringify(variant, (_key, val) =>
        typeof val === "bigint" ? Number(val) : val,
      ),
    );

    if (!canViewCost) {
      delete clone.costMinor;
    }
    return clone;
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateVariantSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid variant update input",
        details: parse.error.flatten(),
      });
    }

    return this.variantsService.update(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Post(":id/barcodes")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async addBarcode(
    @Req() req: any,
    @Param("id") variantId: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = CreateBarcodeSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid barcode input",
        details: parse.error.flatten(),
      });
    }

    const tenantId = req.user.tenantId;

    if (parse.data.productUnitId) {
      const isUnitsActive = await this.modulesService.isModuleActiveForTenant(tenantId, "units");
      if (!isUnitsActive) {
        throw new ForbiddenException({
          code: "MODULE_DISABLED",
          message: "এই বৈশিষ্ট্যের জন্য 'পরিমাপের একক ও রূপান্তর' মডিউলটি চালু থাকতে হবে।",
        });
      }
    }

    return this.variantsService.addBarcode(
      tenantId,
      variantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Put(":id/units/:unitId/price")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async setUnitPrice(
    @Req() req: any,
    @Param("id") variantId: string,
    @Param("unitId") unitId: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = SetVariantUnitPriceSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid variant unit price input",
        details: parse.error.flatten(),
      });
    }

    return this.unitsService.setVariantUnitPrice(
      req.user.tenantId,
      variantId,
      unitId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Delete(":id/units/:unitId/price")
  @RequireModule("units")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async clearUnitPrice(
    @Req() req: any,
    @Param("id") variantId: string,
    @Param("unitId") unitId: string,
    @Ip() ip: string,
  ) {
    return this.unitsService.clearVariantUnitPrice(
      req.user.tenantId,
      variantId,
      unitId,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Delete(":id/barcodes/:barcodeId")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async removeBarcode(
    @Req() req: any,
    @Param("id") variantId: string,
    @Param("barcodeId") barcodeId: string,
    @Ip() ip: string,
  ) {
    return this.variantsService.removeBarcode(
      req.user.tenantId,
      variantId,
      barcodeId,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Post(":id/generate-barcode")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async generateBarcode(
    @Req() req: any,
    @Param("id") variantId: string,
    @Ip() ip: string,
  ) {
    return this.variantsService.generateBarcodeForVariant(
      req.user.tenantId,
      variantId,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Post("products/:productId/generate-barcodes")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async generateProductBarcodes(
    @Req() req: any,
    @Param("productId") productId: string,
    @Ip() ip: string,
  ) {
    return this.variantsService.generateBarcodesForProduct(
      req.user.tenantId,
      productId,
      req.user.userId || req.user.id,
      ip,
    );
  }
}
