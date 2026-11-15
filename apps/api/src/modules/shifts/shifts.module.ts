import { Module } from "@nestjs/common";
import { CustomersService } from "./customers.service.js";
import { CustomersController } from "./customers.controller.js";
import { RegistersService } from "./registers.service.js";
import { RegistersController } from "./registers.controller.js";
import { ShiftsService } from "./shifts.service.js";
import { ShiftsController } from "./shifts.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    CustomersController,
    RegistersController,
    ShiftsController,
  ],
  providers: [
    CustomersService,
    RegistersService,
    ShiftsService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [CustomersService, RegistersService, ShiftsService],
})
export class ShiftsModule {}
