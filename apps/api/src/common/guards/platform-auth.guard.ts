import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Request } from "express";
import { ConfigService } from "../config/config.service.js";
import { SystemDbService } from "../database/system-db.service.js";

export interface PlatformAdminPayload {
  sub: string;
  email: string;
  name?: string;
  scope: string;
}

export interface PlatformAuthenticatedRequest extends Request {
  platformAdmin: {
    id: string;
    email: string;
    name: string;
  };
}

@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly systemDb: SystemDbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformAuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException("Platform authentication token is required");
    }

    try {
      const payload = await this.jwtService.verifyAsync<PlatformAdminPayload>(token, {
        secret: this.configService.get("PLATFORM_JWT_SECRET"),
      });

      if (!payload || payload.scope !== "platform") {
        throw new UnauthorizedException("Invalid platform token scope");
      }

      // Verify platform admin exists and is active using system connection
      const admin = await this.systemDb.findPlatformAdminById(payload.sub);
      if (!admin || !admin.isActive) {
        throw new UnauthorizedException("Platform admin account is inactive or not found");
      }

      request.platformAdmin = {
        id: admin.id,
        email: admin.email,
        name: admin.name,
      };

      return true;
    } catch (err: any) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }
      throw new UnauthorizedException("Invalid or expired platform token");
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(" ") ?? [];
    return type === "Bearer" ? token : undefined;
  }
}
