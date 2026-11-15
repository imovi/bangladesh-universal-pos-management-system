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
  ) {
    return this.usersService.findMany(
      user.tenantId,
      Number(page) || 1,
      Number(limit) || 20,
    );
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
