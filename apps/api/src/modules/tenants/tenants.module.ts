import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service.js";
import { TenantsController } from "./tenants.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, PrismaService, SystemDbService, TenantContextService],
  exports: [TenantsService],
})
export class TenantsModule {}
