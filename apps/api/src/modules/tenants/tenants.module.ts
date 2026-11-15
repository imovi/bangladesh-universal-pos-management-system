import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service.js";
import { TenantsController } from "./tenants.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditModule } from "../audit/audit.module.js";

@Module({
  imports: [AuditModule],
  controllers: [TenantsController],
  providers: [TenantsService, PrismaService],
  exports: [TenantsService],
})
export class TenantsModule {}
