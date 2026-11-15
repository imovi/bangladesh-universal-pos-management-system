import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { RolesService } from "./roles.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import {
  PERMISSIONS,
  CreateRoleDto,
  UpdateRoleDto,
  JwtPayload,
} from "@universal-pos/shared";

@Controller("roles")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.ROLE_READ)
  async getRoles(@CurrentUser() user: JwtPayload) {
    return this.rolesService.findMany(user.tenantId);
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.ROLE_READ)
  async getRoleById(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.rolesService.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createRole(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateRoleDto,
  ) {
    return this.rolesService.create(user.tenantId, body, user.sub);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async updateRole(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: UpdateRoleDto,
  ) {
    return this.rolesService.update(user.tenantId, id, body, user.sub);
  }

  @Delete(":id")
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async deleteRole(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.rolesService.delete(user.tenantId, id, user.sub);
  }
}
