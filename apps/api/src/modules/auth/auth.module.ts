import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "../../common/config/config.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditModule } from "../audit/audit.module.js";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [AuthService, ConfigService, PrismaService],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
