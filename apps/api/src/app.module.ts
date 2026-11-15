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
