import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ConfigService } from "../../common/config/config.service.js";
import { AuditService } from "../audit/audit.service.js";
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
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async login(payload: LoginDto, ip?: string) {
    const parseResult = LoginSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException("Invalid login credentials format");
    }

    const { tenantSlug, email, password } = parseResult.data;

    // 1. Locate Tenant
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
    });

    if (!tenant || tenant.status !== "active") {
      throw new UnauthorizedException("Invalid tenant or account credentials");
    }

    // 2. Locate User
    const user = await this.prisma.user.findUnique({
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

    // 3. Verify Argon2 password
    const isPasswordValid = await argon2.verify(user.passwordHash, password);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid tenant or account credentials");
    }

    // 4. Compile Roles & Permissions
    const roleNames = user.userRoles.map((ur) => ur.role.name);
    const isOwner = roleNames.includes(SYSTEM_ROLES.OWNER);

    let permissionSet = new Set<string>();
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

    // 5. Generate Access & Refresh Tokens
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
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.prisma.refreshToken.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    // 6. Update last login
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 7. Audit log
    await this.auditService.log({
      tenantId: tenant.id,
      actorUserId: user.id,
      action: "auth.login",
      entityType: "User",
      entityId: user.id,
      ip,
    });

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
      },
    };
  }

  async refresh(payload: RefreshTokenDto) {
    const parseResult = RefreshTokenSchema.safeParse(payload);
    if (!parseResult.success) {
      throw new BadRequestException("Refresh token is required");
    }

    const rawToken = parseResult.data.refreshToken;
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    const tokenRecord = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: {
        user: {
          include: {
            tenant: true,
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
        },
      },
    });

    if (!tokenRecord) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    // Refresh Token Reuse Detection
    if (tokenRecord.revokedAt !== null) {
      // Invalidate all tokens for this user!
      await this.prisma.refreshToken.updateMany({
        where: { userId: tokenRecord.userId },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException(
        "Security alert: Revoked refresh token reused. All sessions invalidated.",
      );
    }

    if (new Date() > tokenRecord.expiresAt) {
      throw new UnauthorizedException("Refresh token has expired");
    }

    const { user } = tokenRecord;
    if (!user.isActive || user.tenant.status !== "active") {
      throw new UnauthorizedException("User or tenant account is inactive");
    }

    // Rotate: Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revokedAt: new Date() },
    });

    // Issue new pair
    const roleNames = user.userRoles.map((ur) => ur.role.name);
    const isOwner = roleNames.includes(SYSTEM_ROLES.OWNER);

    let permissionSet = new Set<string>();
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
      tenantSlug: user.tenant.slug,
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

    await this.prisma.refreshToken.create({
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
  }

  async logout(payload: RefreshTokenDto) {
    if (!payload.refreshToken) return { loggedOut: true };
    const tokenHash = crypto
      .createHash("sha256")
      .update(payload.refreshToken)
      .digest("hex");
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
    return { loggedOut: true };
  }

  async getMe(userId: string, tenantId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: {
        tenant: true,
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

    let permissionSet = new Set<string>();
    if (isOwner) {
      permissionSet.add("*");
    } else {
      user.userRoles.forEach((ur) => {
        ur.role.rolePermissions.forEach((rp) => {
          permissionSet.add(rp.permissionKey);
        });
      });
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      tenantId: user.tenantId,
      tenantName: user.tenant.name,
      tenantSlug: user.tenant.slug,
      roles: roleNames,
      permissions: Array.from(permissionSet),
      branches: user.userBranches.map((ub) => ({
        id: ub.branch.id,
        name: ub.branch.name,
        code: ub.branch.code,
      })),
      isOwner,
    };
  }
}
