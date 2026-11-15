import { Module } from "@nestjs/common";
import { TenantsService } from "./tenants.service.js";
import { TenantsController } from "./tenants.controller.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, PrismaService, SystemDbService],
  exports: [TenantsService],
})
export class TenantsModule {}
