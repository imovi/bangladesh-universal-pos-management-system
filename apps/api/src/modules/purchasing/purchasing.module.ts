import { Module } from "@nestjs/common";
import { SuppliersService } from "./suppliers.service.js";
import { SuppliersController } from "./suppliers.controller.js";
import { PurchaseOrdersService } from "./purchase-orders.service.js";
import { PurchaseOrdersController } from "./purchase-orders.controller.js";
import { GoodsReceiptsService } from "./goods-receipts.service.js";
import { GoodsReceiptsController } from "./goods-receipts.controller.js";
import { SupplierPaymentsService } from "./supplier-payments.service.js";
import { SupplierPaymentsController } from "./supplier-payments.controller.js";
import { AuditModule } from "../audit/audit.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { InventoryModule } from "../inventory/inventory.module.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";

@Module({
  imports: [AuthModule, AuditModule, InventoryModule],
  controllers: [
    SuppliersController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    SupplierPaymentsController,
  ],
  providers: [
    SuppliersService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    SupplierPaymentsService,
    PrismaService,
    TenantContextService,
    ConfigService,
  ],
  exports: [
    SuppliersService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    SupplierPaymentsService,
  ],
})
export class PurchasingModule {}
