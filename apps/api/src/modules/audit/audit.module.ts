import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { AuditController } from "./audit.controller.js";
import { DailyHealthAlertService } from "./daily-health.service.js";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "../../common/config/config.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

@Module({
  imports: [JwtModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    DailyHealthAlertService,
    ConfigService,
    PrismaService,
    TenantContextService,
  ],
  exports: [AuditService, DailyHealthAlertService],
})
export class AuditModule {}
