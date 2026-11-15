import { Module } from "@nestjs/common";
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

@Module({
  imports: [
    TenantsModule,
    AuthModule,
    BranchesModule,
    UsersModule,
    RolesModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [
    ConfigService,
    PrismaService,
    TenantContextService,
    SystemDbService,
  ],
  exports: [
    ConfigService,
    PrismaService,
    TenantContextService,
    SystemDbService,
  ],
})
export class AppModule {}
