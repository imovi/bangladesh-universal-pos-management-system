import { Module } from "@nestjs/common";
import { BranchesService } from "./branches.service.js";
import { BranchesController } from "./branches.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [BranchesController],
  providers: [BranchesService, PrismaService, TenantContextService, ConfigService],
  exports: [BranchesService],
})
export class BranchesModule {}
