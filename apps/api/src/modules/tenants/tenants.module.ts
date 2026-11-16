import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service.js";
import { TenantsController } from "./tenants.controller.js";
import { SettingsController } from "./settings.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [TenantsController, SettingsController],
  providers: [
    TenantsService,
    PrismaService,
    SystemDbService,
    TenantContextService,
    ConfigService,
  ],
  exports: [TenantsService],
})
export class TenantsModule {}
