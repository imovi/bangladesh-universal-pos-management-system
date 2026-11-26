import { describe, it, expect, vi } from "vitest";
import crypto from "crypto";
import {
  envSchema,
  EXAMPLE_JWT_ACCESS_SECRET,
  EXAMPLE_JWT_REFRESH_SECRET,
  FORBIDDEN_JWT_SECRETS,
} from "../src/common/config/config.service.js";
import { PrismaService } from "../src/common/database/prisma.service.js";

describe("Production Configuration & Database Role Hardening", () => {
  const baseValidProdEnv = {
    NODE_ENV: "production",
    PORT: "4000",
    DATABASE_URL: "postgresql://pos_runtime:v8A_strongRandomPasswd123456789@postgres:5432/universal_pos",
    REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "c841a0b1297e4e138bebf3b7596b42b781682390a3c242ef9a02347192837461",
    JWT_REFRESH_SECRET: "d952b1c2308f5f249cfcf4c8607c53c892793401b4d353fa0b13458203948572",
    PLATFORM_JWT_SECRET: "e163c2d341906a25b0d0e1d970894502c28a4512b5e4640b1245690314059683",
    CORS_ORIGINS: "https://pos.artisan.com",
  };

  it("accepts valid production configuration", () => {
    const result = envSchema.safeParse(baseValidProdEnv);
    expect(result.success).toBe(true);
  });

  it("accepts a valid cryptographically generated secrets set (from gen-secrets.cjs logic)", () => {
    const generatedEnv = {
      ...baseValidProdEnv,
      DATABASE_URL: `postgresql://pos_runtime:${crypto.randomBytes(24).toString("base64url")}@postgres:5432/universal_pos`,
      JWT_ACCESS_SECRET: crypto.randomBytes(32).toString("hex"),
      JWT_REFRESH_SECRET: crypto.randomBytes(32).toString("hex"),
      PLATFORM_JWT_SECRET: crypto.randomBytes(32).toString("hex"),
    };
    const result = envSchema.safeParse(generatedEnv);
    expect(result.success).toBe(true);
  });

  it("refuses to start when JWT_ACCESS_SECRET is shorter than 32 bytes in production", () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      JWT_ACCESS_SECRET: "short-key-less-than-32-chars",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(
        msgs.some((m) => m.includes("JWT_ACCESS_SECRET must be at least 32 bytes") || m.includes("at least 32 characters")),
      ).toBe(true);
    }
  });

  it("rejects each placeholder JWT secret from .env.example and deploy/.env.production.example", () => {
    for (const forbidden of FORBIDDEN_JWT_SECRETS) {
      const resultAccess = envSchema.safeParse({
        ...baseValidProdEnv,
        JWT_ACCESS_SECRET: forbidden,
      });
      expect(resultAccess.success).toBe(false);

      const resultRefresh = envSchema.safeParse({
        ...baseValidProdEnv,
        JWT_REFRESH_SECRET: forbidden,
      });
      expect(resultRefresh.success).toBe(false);
    }
  });

  it("rejects secrets containing case-insensitive placeholder patterns (replace-with, change-me, example)", () => {
    const patterns = [
      "my-strong-token-with-REPLACE-WITH-something-32-chars-long",
      "my-strong-token-with-Change-Me-something-32-chars-long",
      "my-strong-token-with-EXAMPLE-something-32-chars-long",
    ];

    for (const pat of patterns) {
      const res = envSchema.safeParse({
        ...baseValidProdEnv,
        JWT_ACCESS_SECRET: pat,
      });
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.error.errors.some((e) => e.message.includes("placeholder patterns"))).toBe(true);
      }
    }
  });

  it("rejects identical JWT_ACCESS_SECRET and JWT_REFRESH_SECRET", () => {
    const sharedSecret = crypto.randomBytes(32).toString("hex");
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      JWT_ACCESS_SECRET: sharedSecret,
      JWT_REFRESH_SECRET: sharedSecret,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(msgs.some((m) => m.includes("cannot be identical in production"))).toBe(true);
    }
  });

  it("rejects weak database passwords (pos_secret, pos_runtime_secret, replace-with)", () => {
    const weakUrls = [
      "postgresql://pos_admin:pos_secret@postgres:5432/universal_pos",
      "postgresql://pos_runtime:pos_runtime_secret@postgres:5432/universal_pos",
      "postgresql://pos_runtime:replace-with-generated-runtime-password@postgres:5432/universal_pos",
    ];

    for (const url of weakUrls) {
      const result = envSchema.safeParse({
        ...baseValidProdEnv,
        DATABASE_URL: url,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors.some((e) => e.message.includes("weak or placeholder passwords"))).toBe(true);
      }
    }
  });

  it("guarantees error messages never contain the secret values themselves", () => {
    const sensitiveAccess = "SUPER_SECRET_LEAK_TEST_VALUE_ACCESS_9999999999";
    const sensitiveDbPass = "SUPER_SECRET_LEAK_TEST_VALUE_DB_888888888888";

    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      JWT_ACCESS_SECRET: `replace-with-${sensitiveAccess}`,
      JWT_REFRESH_SECRET: `replace-with-${sensitiveAccess}`,
      DATABASE_URL: `postgresql://pos_runtime:replace-with-${sensitiveDbPass}@localhost:5432/db`,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const errorString = JSON.stringify(result.error);
      expect(errorString.includes(sensitiveAccess)).toBe(false);
      expect(errorString.includes(sensitiveDbPass)).toBe(false);
    }
  });

  it("refuses to start when CORS_ORIGINS is missing or empty in production", () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      CORS_ORIGINS: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(msgs.some((m) => m.includes("CORS_ORIGINS"))).toBe(true);
    }
  });

  it("refuses to start when CORS_ORIGINS contains wildcard (*) in production", () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      CORS_ORIGINS: "https://pos.artisan.com,*",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(msgs.some((m) => m.includes("cannot contain wildcard (*) in production"))).toBe(true);
    }
  });

  describe("PrismaService startup hardening checks in production (mocked $queryRaw)", () => {
    const originalEnv = process.env.NODE_ENV;

    it("refuses startup if connected user is a PostgreSQL superuser", async () => {
      process.env.NODE_ENV = "production";
      const prisma = new PrismaService();
      vi.spyOn(prisma, "$connect").mockResolvedValue(undefined as any);
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ is_superuser: "on" }] as any);

      await expect(prisma.onModuleInit()).rejects.toThrow("FATAL: Database connection user is a PostgreSQL superuser");
      process.env.NODE_ENV = originalEnv;
    });

    it("refuses startup if connected user has rolbypassrls = true", async () => {
      process.env.NODE_ENV = "production";
      const prisma = new PrismaService();
      vi.spyOn(prisma, "$connect").mockResolvedValue(undefined as any);
      // is_superuser: off
      vi.spyOn(prisma, "$queryRaw")
        .mockResolvedValueOnce([{ is_superuser: "off" }] as any)
        .mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: true }] as any);

      await expect(prisma.onModuleInit()).rejects.toThrow("FATAL: Database connection user has BYPASSRLS privilege");
      process.env.NODE_ENV = originalEnv;
    });

    it("refuses startup if connected user owns tables in the public schema", async () => {
      process.env.NODE_ENV = "production";
      const prisma = new PrismaService();
      vi.spyOn(prisma, "$connect").mockResolvedValue(undefined as any);
      // is_superuser: off, rolsuper: false, rolbypassrls: false, tables count: 5
      vi.spyOn(prisma, "$queryRaw")
        .mockResolvedValueOnce([{ is_superuser: "off" }] as any)
        .mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: false }] as any)
        .mockResolvedValueOnce([{ count: 5n }] as any);

      await expect(prisma.onModuleInit()).rejects.toThrow("FATAL: Database connection user owns tables in public schema");
      process.env.NODE_ENV = originalEnv;
    });

    it("allows startup if connected user is non-superuser, no bypassrls, and owns 0 tables", async () => {
      process.env.NODE_ENV = "production";
      const prisma = new PrismaService();
      vi.spyOn(prisma, "$connect").mockResolvedValue(undefined as any);
      vi.spyOn(prisma, "$queryRaw")
        .mockResolvedValueOnce([{ is_superuser: "off" }] as any)
        .mockResolvedValueOnce([{ rolsuper: false, rolbypassrls: false }] as any)
        .mockResolvedValueOnce([{ count: 0n }] as any);

      await expect(prisma.onModuleInit()).resolves.toBeUndefined();
      process.env.NODE_ENV = originalEnv;
    });
  });

  it("runtime database user cannot BYPASSRLS and is not a superuser (real db verification)", async () => {
    const runtimeUrl =
      process.env.TEST_DATABASE_URL ||
      process.env.DATABASE_URL ||
      "postgresql://pos_runtime:pos_runtime_secret@localhost:5432/universal_pos_test?schema=public";

    const prisma = new PrismaService();
    try {
      const roles = await prisma.$queryRaw<
        Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
      >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`;

      expect(roles.length).toBe(1);
      expect(roles[0].rolsuper).toBe(false);
      expect(roles[0].rolbypassrls).toBe(false);

      // Verify that DROP TABLE is forbidden for runtime user
      await expect(
        prisma.$executeRawUnsafe("DROP TABLE IF EXISTS products;"),
      ).rejects.toThrow();
    } finally {
      await prisma.$disconnect();
    }
  });
});
