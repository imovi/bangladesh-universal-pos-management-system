import { Module } from "@nestjs/common";
import { SalesService } from "./sales.service.js";
import { ReturnsService } from "./returns.service.js";
import { SalesController } from "./sales.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { ShiftsModule } from "../shifts/shifts.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";

@Module({
  imports: [AuthModule, AuditModule, InventoryModule, ShiftsModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    ReturnsService,
    PrismaService,
    TenantContextService,
    ConfigService,
    SystemDbService,
  ],
  exports: [SalesService, ReturnsService],
})
export class SalesModule {}
