import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ModulesController } from "./modules.controller.js";
import { ModulesService } from "./modules.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [JwtModule],
  controllers: [ModulesController],
  providers: [
    ModulesService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [ModulesService],
})
export class ModulesModule {}
