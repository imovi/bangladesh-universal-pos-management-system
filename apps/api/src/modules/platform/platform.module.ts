import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PlatformController } from "./platform.controller.js";
import { PlatformService } from "./platform.service.js";
import { PlatformAuthGuard } from "../../common/guards/platform-auth.guard.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [JwtModule],
  controllers: [PlatformController],
  providers: [
    PlatformService,
    PlatformAuthGuard,
    PrismaService,
    SystemDbService,
    ConfigService,
  ],
  exports: [PlatformService, PlatformAuthGuard],
})
export class PlatformModule {}
