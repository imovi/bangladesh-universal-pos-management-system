import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { UsersService } from "./users.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import {
  PERMISSIONS,
  CreateUserDto,
  UpdateUserDto,
  JwtPayload,
} from "@universal-pos/shared";

@Controller("users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission(PERMISSIONS.USER_READ)
  async getUsers(
    @CurrentUser() user: JwtPayload,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Query("search") search?: string,
    @Query("roleId") roleId?: string,
    @Query("branchId") branchId?: string,
    @Query("isActive") isActive?: string,
    @Query("sortBy") sortBy?: string,
    @Query("sortOrder") sortOrder?: "asc" | "desc",
  ) {
    return this.usersService.findMany(user.tenantId, {
      page: Number(page) || 1,
      limit: Number(limit) || 20,
      search,
      roleId,
      branchId,
      isActive,
      sortBy,
      sortOrder,
    });
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.USER_READ)
  async getUserById(@CurrentUser() user: JwtPayload, @Param("id") id: string) {
    return this.usersService.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.USER_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateUserDto,
  ) {
    return this.usersService.create(user.tenantId, body, user.sub);
  }

  @Patch("me/pin")
  async setMyPin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { pin: string },
  ) {
    return this.usersService.setPin(user.tenantId, user.sub, body.pin);
  }

  @Patch(":id/pin")
  @RequirePermission(PERMISSIONS.USER_MANAGE)
  async setUserPin(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: { pin: string },
  ) {
    return this.usersService.setPin(user.tenantId, id, body.pin);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.USER_MANAGE)
  async updateUser(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: UpdateUserDto,
  ) {
    return this.usersService.update(user.tenantId, id, body, user.sub);
  }
}
