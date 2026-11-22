import { Module } from "@nestjs/common";
import { ImportController } from "./import.controller.js";
import { ImportService } from "./import.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ImportController],
  providers: [
    ImportService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [ImportService],
})
export class ImportModule {}
