import { Module } from "@nestjs/common";
import { TransfersController } from "./transfers.controller.js";
import { TransfersService } from "./transfers.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule, InventoryModule],
  controllers: [TransfersController],
  providers: [
    TransfersService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [TransfersService],
})
export class TransfersModule {}
