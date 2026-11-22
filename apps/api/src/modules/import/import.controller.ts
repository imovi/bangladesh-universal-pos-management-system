import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import type { Response } from "express";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { PERMISSIONS } from "@universal-pos/shared";
import { ImportService, ImportType } from "./import.service.js";

interface ImportBody {
  type: ImportType;
  csvText: string;
}

@Controller("import")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  @Get("templates/:type")
  @RequirePermission(PERMISSIONS.DATA_IMPORT)
  getTemplate(@Param("type") type: string, @Res() res: Response) {
    if (!["products", "stock", "customers"].includes(type)) {
      throw new BadRequestException(`Invalid template type: ${type}`);
    }

    const csvContent = this.importService.getTemplate(type as ImportType);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${type}-template.csv"`
    );
    res.status(HttpStatus.OK).send(csvContent);
  }

  @Post("preview")
  @RequirePermission(PERMISSIONS.DATA_IMPORT)
  @HttpCode(HttpStatus.OK)
  async preview(@Req() req: any, @Body() body: ImportBody) {
    if (!body || !body.type || !body.csvText) {
      throw new BadRequestException("type and csvText are required");
    }
    if (!["products", "stock", "customers"].includes(body.type)) {
      throw new BadRequestException(`Invalid import type: ${body.type}`);
    }

    const tenantId = req.user.tenantId;
    return this.importService.preview(tenantId, body.type, body.csvText);
  }

  @Post("commit")
  @RequirePermission(PERMISSIONS.DATA_IMPORT)
  @HttpCode(HttpStatus.OK)
  async commit(@Req() req: any, @Body() body: ImportBody) {
    if (!body || !body.type || !body.csvText) {
      throw new BadRequestException("type and csvText are required");
    }
    if (!["products", "stock", "customers"].includes(body.type)) {
      throw new BadRequestException(`Invalid import type: ${body.type}`);
    }

    const tenantId = req.user.tenantId;
    const userId = req.user.sub || req.user.userId || req.user.id;
    return this.importService.commit(tenantId, userId, body.type, body.csvText);
  }
}
