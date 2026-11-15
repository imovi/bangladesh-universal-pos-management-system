import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service.js";
import { AuthController } from "./auth.controller.js";
import { JwtModule } from "@nestjs/jwt";
import { ConfigService } from "../../common/config/config.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    ConfigService,
    PrismaService,
    TenantContextService,
    SystemDbService,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
