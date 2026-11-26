import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  Req,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import { ModulesService } from "./modules.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import type { AuthenticatedRequest } from "../../common/types/request.js";
import { SYSTEM_ROLES } from "@universal-pos/shared";

const UpdateModuleEnabledSchema = z.object({
  enabled: z.boolean(),
});

@Controller("modules")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ModulesController {
  constructor(private readonly modulesService: ModulesService) {}

  @Get()
  async getModules(@Req() req: AuthenticatedRequest) {
    return this.modulesService.getModulesForTenant(req.user.tenantId);
  }

  @Patch(":key")
  async updateModule(
    @Param("key") key: string,
    @Body() body: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    const isOwner =
      Boolean(req.user.isOwner) ||
      Boolean(req.user.roles?.includes(SYSTEM_ROLES.OWNER));
    if (!isOwner) {
      throw new ForbiddenException("Only Owner can update module settings");
    }

    const parse = UpdateModuleEnabledSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    const actorUserId = req.user.sub;
    return this.modulesService.updateModuleEnabled(
      req.user.tenantId,
      key,
      parse.data.enabled,
      actorUserId,
    );
  }
}
