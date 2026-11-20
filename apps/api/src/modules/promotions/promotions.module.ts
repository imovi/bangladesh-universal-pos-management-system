import { Module } from "@nestjs/common";
import { PromotionsController } from "./promotions.controller.js";
import { PromotionsService } from "./promotions.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PromotionsController],
  providers: [PromotionsService, TenantContextService, PrismaService, ConfigService],
  exports: [PromotionsService],
})
export class PromotionsModule {}
