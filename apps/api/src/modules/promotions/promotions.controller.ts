import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
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
  CreatePromotionSchema,
  UpdatePromotionSchema,
  PromotionQuerySchema,
  PreviewPromotionSchema,
} from "@universal-pos/shared";
import { PromotionsService } from "./promotions.service.js";

@Controller("promotions")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.PROMOTION_VIEW)
  async findAll(@Req() req: any, @Query() query: any) {
    const parse = PromotionQuerySchema.safeParse(query);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        errors: parse.error.flatten(),
      });
    }
    return this.promotionsService.findAll(req.user.tenantId, parse.data);
  }

  @Post("preview")
  @RequirePermission(PERMISSIONS.PROMOTION_VIEW)
  @HttpCode(HttpStatus.OK)
  async preview(@Body() body: any) {
    const parse = PreviewPromotionSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid preview payload",
        errors: parse.error.flatten(),
      });
    }
    return this.promotionsService.preview(parse.data);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.PROMOTION_VIEW)
  async findById(@Req() req: any, @Param("id") id: string) {
    return this.promotionsService.findById(req.user.tenantId, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: any, @Body() body: any, @Ip() ip: string) {
    const parse = CreatePromotionSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid promotion input",
        errors: parse.error.flatten(),
      });
    }
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.create(
      req.user.tenantId,
      userId,
      parse.data,
      ip,
    );
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  async update(
    @Req() req: any,
    @Param("id") id: string,
    @Body() body: any,
    @Ip() ip: string,
  ) {
    const parse = UpdatePromotionSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        message: "Invalid promotion update",
        errors: parse.error.flatten(),
      });
    }
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.update(
      req.user.tenantId,
      userId,
      id,
      parse.data,
      ip,
    );
  }

  @Post(":id/pause")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.OK)
  async pause(@Req() req: any, @Param("id") id: string, @Ip() ip: string) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.pause(req.user.tenantId, userId, id, ip);
  }

  @Post(":id/resume")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.OK)
  async resume(@Req() req: any, @Param("id") id: string, @Ip() ip: string) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.resume(req.user.tenantId, userId, id, ip);
  }

  @Post(":id/end")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.OK)
  async end(@Req() req: any, @Param("id") id: string, @Ip() ip: string) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.end(req.user.tenantId, userId, id, ip);
  }

  @Post(":id/duplicate")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Req() req: any, @Param("id") id: string, @Ip() ip: string) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.duplicate(req.user.tenantId, userId, id, ip);
  }

  @Delete(":id")
  @RequirePermission(PERMISSIONS.PROMOTION_MANAGE)
  @HttpCode(HttpStatus.OK)
  async delete(@Req() req: any, @Param("id") id: string, @Ip() ip: string) {
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.promotionsService.delete(req.user.tenantId, userId, id, ip);
  }
}
