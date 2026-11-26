import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { ConfigService } from "./common/config/config.service.js";
import { PrismaService } from "./common/database/prisma.service.js";
import { TenantContextService } from "./common/database/tenant-context.service.js";
import { SystemDbService } from "./common/database/system-db.service.js";
import { HealthController } from "./modules/health.controller.js";
import { TenantsModule } from "./modules/tenants/tenants.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BranchesModule } from "./modules/branches/branches.module.js";
import { UsersModule } from "./modules/users/users.module.js";
import { RolesModule } from "./modules/roles/roles.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { PurchasingModule } from "./modules/purchasing/purchasing.module.js";
import { ShiftsModule } from "./modules/shifts/shifts.module.js";
import { SalesModule } from "./modules/sales/sales.module.js";
import { ReportsModule } from "./modules/reports/reports.module.js";
import { TransfersModule } from "./modules/transfers/transfers.module.js";
import { PromotionsModule } from "./modules/promotions/promotions.module.js";
import { LoyaltyModule } from "./modules/loyalty/loyalty.module.js";
import { ImportModule } from "./modules/import/import.module.js";
import { PlatformModule } from "./modules/platform/platform.module.js";
import { ModulesModule } from "./modules/modules/modules.module.js";

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: (Number(process.env.RATE_LIMIT_TTL) || 60) * 1000,
        limit: Number(process.env.RATE_LIMIT_LIMIT) || 100,
      },
    ]),
    TenantsModule,
    AuthModule,
    BranchesModule,
    UsersModule,
    RolesModule,
    AuditModule,
    CatalogModule,
    InventoryModule,
    PurchasingModule,
    ShiftsModule,
    SalesModule,
    ReportsModule,
    TransfersModule,
    PromotionsModule,
    LoyaltyModule,
    ImportModule,
    PlatformModule,
    ModulesModule,
  ],
  controllers: [HealthController],
  providers: [
    ConfigService,
    PrismaService,
    TenantContextService,
    SystemDbService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
  exports: [
    ConfigService,
    PrismaService,
    TenantContextService,
    SystemDbService,
  ],
})
export class AppModule {}
