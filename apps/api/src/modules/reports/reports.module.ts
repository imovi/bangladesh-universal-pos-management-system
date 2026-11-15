import { Module } from "@nestjs/common";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    PrismaService,
    TenantContextService,
    ConfigService,
    SystemDbService,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
