import { Module } from "@nestjs/common";
import { ProductsService } from "./products.service.js";
import { VariantsService } from "./variants.service.js";
import { UnitsService } from "./units.service.js";
import { CatalogMetadataService } from "./metadata.service.js";
import { ProductsController } from "./products.controller.js";
import { VariantsController } from "./variants.controller.js";
import {
  CategoriesController,
  BrandsController,
  CollectionsController,
  TaxClassesController,
} from "./metadata.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ModulesModule } from "../modules/modules.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule, ModulesModule],
  controllers: [
    ProductsController,
    VariantsController,
    CategoriesController,
    BrandsController,
    CollectionsController,
    TaxClassesController,
  ],
  providers: [
    ProductsService,
    VariantsService,
    UnitsService,
    CatalogMetadataService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [ProductsService, VariantsService, UnitsService, CatalogMetadataService],
})
export class CatalogModule {}
