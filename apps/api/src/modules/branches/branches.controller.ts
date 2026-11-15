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
import { BranchesService } from "./branches.service.js";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard.js";
import { PermissionsGuard } from "../../common/guards/permissions.guard.js";
import { RequirePermission } from "../../common/decorators/require-permission.decorator.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
import {
  PERMISSIONS,
  CreateBranchDto,
  UpdateBranchDto,
  JwtPayload,
} from "@universal-pos/shared";

@Controller("branches")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.BRANCH_READ)
  async getBranches(
    @CurrentUser() user: JwtPayload,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.branchesService.findMany(
      user.tenantId,
      Number(page) || 1,
      Number(limit) || 20,
    );
  }

  @Get(":id")
  @RequirePermission(PERMISSIONS.BRANCH_READ)
  async getBranchById(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
  ) {
    return this.branchesService.findById(user.tenantId, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.BRANCH_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  async createBranch(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateBranchDto,
  ) {
    return this.branchesService.create(user.tenantId, body, user.sub);
  }

  @Patch(":id")
  @RequirePermission(PERMISSIONS.BRANCH_MANAGE)
  async updateBranch(
    @CurrentUser() user: JwtPayload,
    @Param("id") id: string,
    @Body() body: UpdateBranchDto,
  ) {
    return this.branchesService.update(user.tenantId, id, body, user.sub);
  }
}
