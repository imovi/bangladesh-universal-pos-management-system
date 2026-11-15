import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";

describe("AuthService Unit Tests", () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockSystemDb: any;
  let mockTenantContext: any;
  let mockJwtService: any;
  let mockConfigService: any;

  beforeEach(() => {
    mockPrisma = {
      user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      refreshToken: {
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      auditLog: {
        create: vi.fn(),
      },
    };

    mockSystemDb = {
      findTenantBySlug: vi.fn(),
      findTenantById: vi.fn(),
      findRefreshTokenByHash: vi.fn(),
      revokeAllUserRefreshTokens: vi.fn(),
    };

    mockTenantContext = {
      runWithTenant: vi
        .fn()
        .mockImplementation((_id, fn) => fn(mockPrisma)),
    };

    mockJwtService = {
      signAsync: vi.fn().mockResolvedValue("mock-jwt-token"),
    };

    mockConfigService = {
      get: vi.fn().mockImplementation((key: string) => {
        if (key === "JWT_ACCESS_SECRET") return "secret";
        if (key === "JWT_ACCESS_EXPIRES_IN") return "15m";
        return "";
      }),
    };

    authService = new AuthService(
      mockSystemDb,
      mockTenantContext,
      mockJwtService,
      mockConfigService,
    );
  });

  it("fails login if tenant does not exist or is inactive", async () => {
    mockSystemDb.findTenantBySlug.mockResolvedValue(null);

    await expect(
      authService.login({
        tenantSlug: "non-existent",
        email: "user@test.com",
        password: "Password123!",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("fails login on incorrect password", async () => {
    mockSystemDb.findTenantBySlug.mockResolvedValue({
      id: "0193309a-6b21-7000-8000-000000000001",
      slug: "my-store",
      status: "active",
    });

    const realHash = await argon2.hash("CorrectPassword123!");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "0193309a-6b21-7000-8000-000000000001",
      email: "user@test.com",
      passwordHash: realHash,
      isActive: true,
      userRoles: [],
    });

    await expect(
      authService.login({
        tenantSlug: "my-store",
        email: "user@test.com",
        password: "WrongPassword123!",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("successfully logs in with valid credentials and issues tokens", async () => {
    const tenantId = "0193309a-6b21-7000-8000-000000000001";
    mockSystemDb.findTenantBySlug.mockResolvedValue({
      id: tenantId,
      slug: "my-store",
      status: "active",
    });

    const realHash = await argon2.hash("ValidPassword123!");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId,
      name: "Habib",
      email: "user@test.com",
      passwordHash: realHash,
      isActive: true,
      userRoles: [
        {
          role: {
            name: "Owner",
            rolePermissions: [],
          },
        },
      ],
    });

    const result = await authService.login({
      tenantSlug: "my-store",
      email: "user@test.com",
      password: "ValidPassword123!",
    });

    expect(result.accessToken).toBe("mock-jwt-token");
    expect(result.refreshToken).toMatch(/^rt_/);
    expect(result.user.email).toBe("user@test.com");
    expect(result.user.isOwner).toBe(true);
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it("revokes all user tokens if a revoked token is reused (Compromised Token Reuse Detection)", async () => {
    mockSystemDb.findRefreshTokenByHash.mockResolvedValue({
      id: "token-old",
      userId: "user-1",
      tenantId: "0193309a-6b21-7000-8000-000000000001",
      revokedAt: new Date(Date.now() - 10000), // already revoked!
      expiresAt: new Date(Date.now() + 100000),
      user: {
        isActive: true,
        tenant: { status: "active", slug: "my-store" },
        userRoles: [],
      },
    });

    await expect(
      authService.refresh({ refreshToken: "rt_compromised_token" }),
    ).rejects.toThrow(/Revoked refresh token reused/);

    expect(mockSystemDb.revokeAllUserRefreshTokens).toHaveBeenCalledWith("user-1");
  });

  it("rotates refresh token and returns new token pair", async () => {
    const tenantId = "0193309a-6b21-7000-8000-000000000001";
    mockSystemDb.findTenantById.mockResolvedValue({
      id: tenantId,
      status: "active",
      slug: "my-store",
    });
    mockSystemDb.findRefreshTokenByHash.mockResolvedValue({
      id: "token-valid-id",
      userId: "user-1",
      tenantId,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000000),
    });

    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId,
      email: "user@test.com",
      isActive: true,
      userRoles: [
        {
          role: {
            name: "Cashier",
            rolePermissions: [{ permissionKey: "sale.read" }],
          },
        },
      ],
    });

    const res = await authService.refresh({ refreshToken: "rt_valid_token" });
    expect(res.accessToken).toBe("mock-jwt-token");
    expect(res.refreshToken).toMatch(/^rt_/);
    expect(mockPrisma.refreshToken.update).toHaveBeenCalled();
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it("revokes token on logout", async () => {
    const tenantId = "0193309a-6b21-7000-8000-000000000001";
    mockSystemDb.findRefreshTokenByHash.mockResolvedValue({
      tenantId,
    });
    const res = await authService.logout({ refreshToken: "rt_logout_token" });
    expect(res.loggedOut).toBe(true);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it("retrieves user profile via getMe", async () => {
    const tenantId = "0193309a-6b21-7000-8000-000000000001";
    mockSystemDb.findTenantById.mockResolvedValue({
      id: tenantId,
      name: "My Store",
      slug: "my-store",
    });
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      name: "Habib",
      email: "habib@pos.com",
      phone: "01700000000",
      tenantId,
      tenant: { name: "My Store", slug: "my-store" },
      userRoles: [{ role: { name: "Owner", rolePermissions: [] } }],
      userBranches: [{ branch: { id: "b1", name: "Main", code: "MAIN-01" } }],
    });

    const me = await authService.getMe("user-1", tenantId);
    expect(me.name).toBe("Habib");
    expect(me.isOwner).toBe(true);
    expect(me.permissions).toContain("*");
    expect(me.branches).toHaveLength(1);
  });
});
