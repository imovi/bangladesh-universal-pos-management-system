import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { UnauthorizedException } from "@nestjs/common";
import argon2 from "argon2";

describe("AuthService Unit Tests", () => {
  let authService: AuthService;
  let mockPrisma: any;
  let mockJwtService: any;
  let mockConfigService: any;
  let mockAuditService: any;

  beforeEach(() => {
    mockPrisma = {
      tenant: { findUnique: vi.fn() },
      user: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
      refreshToken: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
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

    mockAuditService = {
      log: vi.fn().mockResolvedValue(true),
    };

    authService = new AuthService(
      mockPrisma,
      mockJwtService,
      mockConfigService,
      mockAuditService,
    );
  });

  it("fails login if tenant does not exist or is inactive", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);

    await expect(
      authService.login({
        tenantSlug: "non-existent",
        email: "user@test.com",
        password: "Password123!",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("fails login on incorrect password", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      slug: "my-store",
      status: "active",
    });

    const realHash = await argon2.hash("CorrectPassword123!");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
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
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      slug: "my-store",
      status: "active",
    });

    const realHash = await argon2.hash("ValidPassword123!");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
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
    mockPrisma.refreshToken.findFirst.mockResolvedValue({
      id: "token-old",
      userId: "user-1",
      tenantId: "tenant-1",
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

    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("rotates refresh token and returns new token pair", async () => {
    mockPrisma.refreshToken.findFirst.mockResolvedValue({
      id: "token-valid-id",
      userId: "user-1",
      tenantId: "tenant-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000000),
      user: {
        id: "user-1",
        tenantId: "tenant-1",
        email: "user@test.com",
        isActive: true,
        tenant: { status: "active", slug: "my-store" },
        userRoles: [
          {
            role: {
              name: "Cashier",
              rolePermissions: [{ permissionKey: "sale.read" }],
            },
          },
        ],
      },
    });

    const res = await authService.refresh({ refreshToken: "rt_valid_token" });
    expect(res.accessToken).toBe("mock-jwt-token");
    expect(res.refreshToken).toMatch(/^rt_/);
    expect(mockPrisma.refreshToken.update).toHaveBeenCalled();
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it("revokes token on logout", async () => {
    const res = await authService.logout({ refreshToken: "rt_logout_token" });
    expect(res.loggedOut).toBe(true);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalled();
  });

  it("retrieves user profile via getMe", async () => {
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "user-1",
      name: "Habib",
      email: "habib@pos.com",
      phone: "01700000000",
      tenantId: "tenant-1",
      tenant: { name: "My Store", slug: "my-store" },
      userRoles: [{ role: { name: "Owner", rolePermissions: [] } }],
      userBranches: [{ branch: { id: "b1", name: "Main", code: "MAIN-01" } }],
    });

    const me = await authService.getMe("user-1", "tenant-1");
    expect(me.name).toBe("Habib");
    expect(me.isOwner).toBe(true);
    expect(me.permissions).toContain("*");
    expect(me.branches).toHaveLength(1);
  });
});
