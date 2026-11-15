import { Module } from "@nestjs/common";
import { SalesService } from "./sales.service.js";
import { SalesController } from "./sales.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule, InventoryModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [SalesService],
})
export class SalesModule {}
