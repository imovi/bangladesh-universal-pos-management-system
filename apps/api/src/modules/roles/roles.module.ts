import { Module } from "@nestjs/common";
import { RolesService } from "./roles.service.js";
import { RolesController } from "./roles.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [RolesController],
  providers: [RolesService, PrismaService, ConfigService],
  exports: [RolesService],
})
export class RolesModule {}
