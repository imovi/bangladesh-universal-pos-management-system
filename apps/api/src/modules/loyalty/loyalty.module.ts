import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { LoyaltyController } from "./loyalty.controller.js";
import { LoyaltyService } from "./loyalty.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule, AuditModule],
  controllers: [LoyaltyController],
  providers: [LoyaltyService, TenantContextService, PrismaService, ConfigService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
