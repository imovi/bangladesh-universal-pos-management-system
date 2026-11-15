import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { Request } from "express";
import { TenantsService } from "./tenants.service.js";
import { TenantSignupDto } from "@universal-pos/shared";

@Controller("tenants")
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post("signup")
  @HttpCode(HttpStatus.CREATED)
  async signup(@Body() body: TenantSignupDto, @Req() req: Request) {
    const ip =
      (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress;
    return this.tenantsService.signup(body, ip);
  }
}
