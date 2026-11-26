import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { PlatformService } from "./platform.service.js";
import {
  PlatformAuthGuard,
  type PlatformAuthenticatedRequest,
} from "../../common/guards/platform-auth.guard.js";

const PlatformLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const UpdateModuleAllowedSchema = z.object({
  allowed: z.boolean(),
});

@Controller("platform")
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Post("auth/login")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: unknown) {
    const parse = PlatformLoginSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }
    return this.platformService.login(parse.data);
  }

  @Get("tenants")
  @UseGuards(PlatformAuthGuard)
  async getTenants() {
    return this.platformService.getTenants();
  }

  @Patch("tenants/:tenantId/modules/:key")
  @UseGuards(PlatformAuthGuard)
  async updateTenantModule(
    @Param("tenantId") tenantId: string,
    @Param("key") key: string,
    @Body() body: unknown,
    @Req() req: PlatformAuthenticatedRequest,
  ) {
    const parse = UpdateModuleAllowedSchema.safeParse(body);
    if (!parse.success) {
      throw new BadRequestException({
        code: "VALIDATION_ERROR",
        errors: parse.error.flatten(),
      });
    }

    return this.platformService.updateTenantModule(
      tenantId,
      key,
      parse.data.allowed,
      req.platformAdmin,
    );
  }
}
