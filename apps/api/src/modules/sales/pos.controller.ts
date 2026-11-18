import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  UseGuards,
  Req,
  Ip,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { PosCatalogService } from "./pos-catalog.service.js";
import { SalesService } from "./sales.service.js";
import { CustomersService } from "../shifts/customers.service.js";
import { ShiftsService } from "../shifts/shifts.service.js";
import { CreateCustomerSchema, CashMovementSchema } from "@universal-pos/shared";

@Controller("pos")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PosController {
  constructor(
    private readonly catalogService: PosCatalogService,
    private readonly salesService: SalesService,
    private readonly customersService: CustomersService,
    private readonly shiftsService: ShiftsService,
  ) {}

  @Get("catalog")
  async getCatalog(
    @Req() req: any,
    @Query("branchId") branchId: string,
    @Query("since") since?: string,
  ) {
    if (!branchId) {
      throw new BadRequestException("branchId is required");
    }
    return this.catalogService.getCatalog(req.user.tenantId, branchId, since);
  }

  @Post("sync")
  async syncBatch(
    @Req() req: any,
    @Body() body: { items: Array<{ type: "sale" | "customer" | "cash_movement"; id: string; payload: any }> },
    @Ip() ip: string,
  ) {
    if (!body || !Array.isArray(body.items)) {
      throw new BadRequestException("Invalid sync batch: items array required");
    }

    if (body.items.length > 50) {
      throw new BadRequestException("Batch limit exceeded: maximum 50 items allowed per sync request");
    }

    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.userId || req.user.id;
    const results: Array<{
      id: string;
      type: string;
      status: "synced" | "failed" | "duplicate";
      saleId?: string;
      invoiceNumber?: string;
      error?: { code: string; message: string };
    }> = [];

    for (const item of body.items) {
      try {
        if (item.type === "sale") {
          const res = await this.salesService.create(tenantId, item.payload, userId, ip, req.user);
          results.push({
            id: item.id,
            type: item.type,
            status: (res as any).isDuplicate ? "duplicate" : "synced",
            saleId: res.id,
            invoiceNumber: res.invoiceNumber,
          });
        } else if (item.type === "customer") {
          const parsed = CreateCustomerSchema.safeParse(item.payload);
          if (!parsed.success) {
            results.push({
              id: item.id,
              type: item.type,
              status: "failed",
              error: { code: "VALIDATION_ERROR", message: "Invalid customer payload" },
            });
            continue;
          }
          await this.customersService.create(tenantId, { ...parsed.data, id: item.id });
          results.push({
            id: item.id,
            type: item.type,
            status: "synced",
          });
        } else if (item.type === "cash_movement") {
          const parsed = CashMovementSchema.safeParse(item.payload);
          if (!parsed.success || !item.payload.shiftId) {
            results.push({
              id: item.id,
              type: item.type,
              status: "failed",
              error: { code: "VALIDATION_ERROR", message: "Invalid cash movement payload" },
            });
            continue;
          }
          await this.shiftsService.addCashMovement(tenantId, item.payload.shiftId, parsed.data, userId, ip);
          results.push({
            id: item.id,
            type: item.type,
            status: "synced",
          });
        } else {
          results.push({
            id: item.id,
            type: item.type,
            status: "failed",
            error: { code: "UNKNOWN_ITEM_TYPE", message: `Unknown item type: ${item.type}` },
          });
        }
      } catch (err: any) {
        const code = err?.response?.code || err?.code || "SYNC_ERROR";
        const message = err?.message || "Sync processing error";
        results.push({
          id: item.id,
          type: item.type,
          status: "failed",
          error: { code, message },
        });
      }
    }

    return { results };
  }
}
