import { Module } from "@nestjs/common";
import { InventoryService } from "./inventory.service.js";
import { InventoryController } from "./inventory.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [InventoryController],
  providers: [
    InventoryService,
    PrismaService,
    TenantContextService,
    SystemDbService,
    ConfigService,
  ],
  exports: [InventoryService],
})
export class InventoryModule {}
