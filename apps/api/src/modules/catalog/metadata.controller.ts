import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
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
  UpdateCategorySchema,
  CreateBrandSchema,
  UpdateBrandSchema,
  CreateCollectionSchema,
  UpdateCollectionSchema,
  CreateTaxClassSchema,
  UpdateTaxClassSchema,
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
    return this.metadataService.createCategory(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findCategories(req.user.tenantId);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.metadataService.findCategoryById(req.user.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateCategorySchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.updateCategory(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
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
    return this.metadataService.createBrand(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findBrands(req.user.tenantId);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.metadataService.findBrandById(req.user.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateBrandSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.updateBrand(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
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
    return this.metadataService.createCollection(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findCollections(req.user.tenantId);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.metadataService.findCollectionById(req.user.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateCollectionSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.updateCollection(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
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
    return this.metadataService.createTaxClass(
      req.user.tenantId,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findAll(@Req() req: any) {
    return this.metadataService.findTaxClasses(req.user.tenantId);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.CATALOG_READ)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.metadataService.findTaxClassById(req.user.tenantId, id);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.CATALOG_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: unknown,
    @Ip() ip: string,
  ) {
    const parse = UpdateTaxClassSchema.safeParse(body);
    if (!parse.success) throw new BadRequestException(parse.error.flatten());
    return this.metadataService.updateTaxClass(
      req.user.tenantId,
      id,
      parse.data,
      req.user.userId || req.user.id,
      ip,
    );
  }
}
