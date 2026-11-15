import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { AuditController } from "./audit.controller.js";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "../../common/config/config.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

@Module({
  imports: [JwtModule],
  controllers: [AuditController],
  providers: [AuditService, ConfigService, PrismaService],
  exports: [AuditService],
})
export class AuditModule {}
