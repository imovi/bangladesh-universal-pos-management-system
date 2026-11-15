import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CatalogMetadataService } from "./metadata.service.js";
import {
  PERMISSIONS,
  CreateCategorySchema,
  CreateBrandSchema,
  CreateCollectionSchema,
  CreateTaxClassSchema,
} from "@universal-pos/shared";

@Controller("categories")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategoriesController {
  constructor(private readonly metadataService: CatalogMetadataService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async create(@Req() req: any, @Body() body: unknown, @Ip() ip: string) {
    const parse = CreateCategorySchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.createCategory(req.user.tenantId, parse.data, req.user.id, ip);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findCategories(req.user.tenantId);
  }
}

@Controller("brands")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BrandsController {
  constructor(private readonly metadataService: CatalogMetadataService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async create(@Req() req: any, @Body() body: unknown, @Ip() ip: string) {
    const parse = CreateBrandSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.createBrand(req.user.tenantId, parse.data, req.user.id, ip);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findBrands(req.user.tenantId);
  }
}

@Controller("collections")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CollectionsController {
  constructor(private readonly metadataService: CatalogMetadataService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async create(@Req() req: any, @Body() body: unknown, @Ip() ip: string) {
    const parse = CreateCollectionSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.createCollection(req.user.tenantId, parse.data, req.user.id, ip);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findCollections(req.user.tenantId);
  }
}

@Controller("tax-classes")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxClassesController {
  constructor(private readonly metadataService: CatalogMetadataService) {}

  @Post()
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async create(@Req() req: any, @Body() body: unknown, @Ip() ip: string) {
    const parse = CreateTaxClassSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.createTaxClass(req.user.tenantId, parse.data, req.user.id, ip);
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findTaxClasses(req.user.tenantId);
  }
}
