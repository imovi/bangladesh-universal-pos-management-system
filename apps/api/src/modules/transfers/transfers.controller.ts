import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Ip,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { PERMISSIONS } from "@universal-pos/shared";
import {
  CreateStockTransferSchema,
  SendStockTransferSchema,
  ReceiveStockTransferSchema,
  StockTransferQuerySchema,
} from "@universal-pos/shared";
import { TransfersService } from "./transfers.service.js";

@Controller("inventory/transfers")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TransfersController {
  constructor(private readonly transfersService: TransfersService) {}

  @Post()
  @RequirePermission(PERMISSIONS.TRANSFER_CREATE)
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() body: any, @Ip() ip: string) {
    const parse = CreateStockTransferSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid transfer input",
        errors: parse.error.flatten(),
      });
    }

    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.transfersService.create(
      req.user.tenantId,
      userId,
      parse.data,
      ip,
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.TRANSFER_READ)
  async findAll(@Req() req: any, @Query() query: any) {
    const parse = StockTransferQuerySchema.safeParse(query);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        errors: parse.error.flatten(),
      });
    }

    const result = await this.transfersService.findAll(req.user.tenantId, parse.data);
    return { items: result.items, pagination: result.meta };
  }

  @Get("in-transit")
  @RequirePermission(PERMISSIONS.TRANSFER_READ)
  async getInTransit(@Req() req: any, @Query("branchId") branchId?: string) {
    return this.transfersService.getInTransitQuantities(
      req.user.tenantId,
      branchId,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.TRANSFER_READ)
  async findOne(@Req() req: any, @Param("id") id: string) {
    return this.transfersService.findOne(req.user.tenantId, id);
  }

  @Post(":id/send")
  @RequirePermission(PERMISSIONS.TRANSFER_SEND)
  @HttpCode(HttpStatus.OK)
  async send(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const parse = SendStockTransferSchema.safeParse(body || {});
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid send payload",
        errors: parse.error.flatten(),
      });
    }

    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.transfersService.send(
      req.user.tenantId,
      userId,
      id,
      parse.data,
      ip,
    );
  }

  @Post(":id/receive")
  @RequirePermission(PERMISSIONS.TRANSFER_RECEIVE)
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const parse = ReceiveStockTransferSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid receive payload",
        errors: parse.error.flatten(),
      });
    }

    const userId = req.user.sub || req.user.userId || req.user.id;
    const userBranches: string[] = req.user.branches || [];
    const isOwner =
      Boolean(req.user.isOwner) ||
      req.user.role === "Owner" ||
      (Array.isArray(req.user.roles) && req.user.roles.includes("Owner"));

    return this.transfersService.receive(
      req.user.tenantId,
      userId,
      userBranches,
      isOwner,
      id,
      parse.data,
      ip,
    );
  }

  @Post(":id/cancel")
  @RequirePermission(PERMISSIONS.TRANSFER_CREATE)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    const reason = typeof body === "object" && body !== null ? body.reason : undefined;
    return this.transfersService.cancel(
      req.user.tenantId,
      userId,
      id,
      reason,
      ip,
    );
  }
}
