import { Module } from "@nestjs/common";
import { UsersService } from "./users.service.js";
import { UsersController } from "./users.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [UsersController],
  providers: [UsersService, PrismaService, ConfigService],
  exports: [UsersService],
})
export class UsersModule {}
