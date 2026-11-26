import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { ConfigService } from "../../common/config/config.service.js";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { MODULE_KEYS, type ModuleKey } from "@universal-pos/shared";

export interface PlatformLoginDto {
  email: string;
  password: string;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly systemDb: SystemDbService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: PlatformLoginDto) {
    const admin = await this.systemDb.findPlatformAdminByEmail(dto.email.toLowerCase().trim());
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const isMatch = await argon2.verify(admin.passwordHash, dto.password);
    if (!isMatch) {
      throw new UnauthorizedException("Invalid credentials");
    }

    await this.systemDb.updatePlatformAdminLastLogin(admin.id);

    const payload = {
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      scope: "platform",
    };

    const secret = this.configService.get("PLATFORM_JWT_SECRET");
    const accessToken = await this.jwtService.signAsync(payload, {
      secret,
      expiresIn: "30m",
    });

    return {
      accessToken,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      },
    };
  }

  async getTenants() {
    return this.systemDb.getAllTenantsWithModules();
  }

  async updateTenantModule(
    tenantId: string,
    key: string,
    allowed: boolean,
    platformAdmin: { id: string; email: string },
  ) {
    if (!MODULE_KEYS.includes(key as ModuleKey)) {
      throw new BadRequestException({
        code: "INVALID_MODULE_KEY",
        message: `Unknown module key: ${key}`,
      });
    }

    return this.systemDb.updateTenantModuleAllowed(
      tenantId,
      key,
      allowed,
      platformAdmin,
    );
  }
}
