import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { SystemDbService } from "../../common/database/system-db.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import argon2 from "argon2";
import crypto from "crypto";
import {
  LoginDto,
  LoginSchema,
  RefreshTokenDto,
  RefreshTokenSchema,
  JwtPayload,
  SYSTEM_ROLES,
} from "@universal-pos/shared";

@Injectable()
export class AuthService {
  constructor(
    private readonly systemDb: SystemDbService,
    private readonly tenantContext: TenantContextService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(payload: LoginDto, ip?: string) {
    const parseResult = LoginSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException("Invalid login credentials format");
    }

    const { tenantSlug, email, password } = parseResult.data;

    // 1. Locate Tenant via SystemDbService (outside tenant boundary)
    const tenant = await this.systemDb.findTenantBySlug(tenantSlug);
    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedException("Invalid tenant or account credentials");
    }

    // 2. Execute user verification, token generation, and audit logging inside Tenant Context (RLS enforced)
    return this.tenantContext.runWithTenant(tenant.id, async (tx) => {
      const user = await tx.user.findUnique({
        where: {
          tenantId_email: {
            tenantId: tenant.id,
            email,
          },
        },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: true,
                },
              },
            },
          },
        },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException("Invalid tenant or account credentials");
      }

      const isPasswordValid = await argon2.verify(user.passwordHash, password);
      if (!isPasswordValid) {
        throw new UnauthorizedException("Invalid tenant or account credentials");
      }

      const roleNames = user.userRoles.map((ur) => ur.role.name);
      const isOwner = roleNames.includes(SYSTEM_ROLES.OWNER);

      const permissionSet = new Set<string>();
      if (isOwner) {
        permissionSet.add("*");
      } else {
        user.userRoles.forEach((ur) => {
          ur.role.rolePermissions.forEach((rp) => {
            permissionSet.add(rp.permissionKey);
          });
        });
      }

      const permissions = Array.from(permissionSet);

      const jwtPayload: JwtPayload = {
        sub: user.id,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        email: user.email,
        roles: roleNames,
        permissions,
        isOwner,
      };

      const accessToken = await this.jwtService.signAsync(jwtPayload, {
        secret: this.configService.get("JWT_ACCESS_SECRET"),
        expiresIn: 900,
      });

      const rawRefreshToken = `rt_${crypto.randomBytes(32).toString("hex")}`;
      const tokenHash = crypto
        .createHash("sha256")
        .update(rawRefreshToken)
        .digest("hex");

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      await tx.refreshToken.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: "auth.login",
          entityType: "User",
          entityId: user.id,
          ip,
        },
      });

      const maxDiscountPercent = isOwner
        ? null
        : user.userRoles.reduce(
            (max, ur) => Math.max(max, ur.role.maxDiscountPercent ?? 0),
            0,
          );

      return {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn: 900,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          roles: roleNames,
          permissions,
          isOwner,
          maxDiscountPercent,
        },
      };
    });
  }

  async refresh(payload: RefreshTokenDto) {
    const parseResult = RefreshTokenSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException("Refresh token is required");
    }

    const rawToken = parseResult.data.refreshToken;
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Look up token via system service
    const tokenRecord = await this.systemDb.findRefreshTokenByHash(tokenHash);
    if (!tokenRecord) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Reuse detection
    if (tokenRecord.revokedAt !== null) {
      await this.systemDb.revokeAllUserRefreshTokens(tokenRecord.userId);
      throw new UnauthorizedException(
        "Security alert: Revoked refresh token reused. All sessions invalidated.",
      );
    }

    if (new Date() > tokenRecord.expiresAt) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    const tenant = await this.systemDb.findTenantById(tokenRecord.tenantId);
    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedException("Tenant account is inactive");
    }

    // Execute token rotation inside Tenant Context
    return this.tenantContext.runWithTenant(tokenRecord.tenantId, async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: tokenRecord.userId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: true,
                },
              },
            },
          },
        },
      });

      if (!user || !user.isActive) {
        throw new UnauthorizedException("User account is inactive");
      }

      await tx.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revokedAt: new Date() },
      });

      const roleNames = user.userRoles.map((ur) => ur.role.name);
      const isOwner = roleNames.includes(SYSTEM_ROLES.OWNER);

      const permissionSet = new Set<string>();
      if (isOwner) {
        permissionSet.add("*");
      } else {
        user.userRoles.forEach((ur) => {
          ur.role.rolePermissions.forEach((rp) => {
            permissionSet.add(rp.permissionKey);
          });
        });
      }

      const jwtPayload: JwtPayload = {
        sub: user.id,
        tenantId: user.tenantId,
        tenantSlug: tenant.slug,
        email: user.email,
        roles: roleNames,
        permissions: Array.from(permissionSet),
        isOwner,
      };

      const newAccessToken = await this.jwtService.signAsync(jwtPayload, {
        secret: this.configService.get("JWT_ACCESS_SECRET"),
        expiresIn: 900,
      });

      const newRawRefreshToken = `rt_${crypto.randomBytes(32).toString("hex")}`;
      const newTokenHash = crypto
        .createHash("sha256")
        .update(newRawRefreshToken)
        .digest("hex");

      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + 30);

      await tx.refreshToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
        },
      });

      return {
        accessToken: newAccessToken,
        refreshToken: newRawRefreshToken,
        expiresIn: 900,
      };
    });
  }

  async logout(payload: RefreshTokenDto) {
    if (!payload.refreshToken) return { loggedOut: true };
    const tokenHash = crypto
      .createHash("sha256")
      .update(payload.refreshToken)
      .digest("hex");

    const record = await this.systemDb.findRefreshTokenByHash(tokenHash);
    if (record) {
      await this.tenantContext.runWithTenant(record.tenantId, async (tx) => {
        await tx.refreshToken.updateMany({
          where: { tokenHash, tenantId: record.tenantId },
          data: { revokedAt: new Date() },
        });
      });
    }

    return { loggedOut: true };
  }

  async getMe(userId: string, tenantId: string) {
    const tenant = await this.systemDb.findTenantById(tenantId);
    if (!tenant) {
      throw new UnauthorizedException("Tenant not found");
    }

    return this.tenantContext.runWithTenant(tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId },
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  rolePermissions: true,
                },
              },
            },
          },
          userBranches: {
            include: {
              branch: true,
            },
          },
        },
      });

      if (!user) {
        throw new UnauthorizedException("User profile not found");
      }

      const roleNames = user.userRoles.map((ur) => ur.role.name);
      const isOwner = roleNames.includes(SYSTEM_ROLES.OWNER);

      const permissionSet = new Set<string>();
      if (isOwner) {
        permissionSet.add("*");
      } else {
        user.userRoles.forEach((ur) => {
          ur.role.rolePermissions.forEach((rp) => {
            permissionSet.add(rp.permissionKey);
          });
        });
      }

      const maxDiscountPercent = isOwner
        ? null
        : user.userRoles.reduce(
            (max, ur) => Math.max(max, ur.role.maxDiscountPercent ?? 0),
            0,
          );

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        tenantId: user.tenantId,
        tenantName: tenant.name,
        tenantSlug: tenant.slug,
        roles: roleNames,
        permissions: Array.from(permissionSet),
        branches: user.userBranches.map((ub) => ({
          id: ub.branch.id,
          name: ub.branch.name,
          code: ub.branch.code,
        })),
        isOwner,
        maxDiscountPercent,
      };
    });
  }
}
