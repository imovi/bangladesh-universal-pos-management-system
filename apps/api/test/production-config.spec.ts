import { describe, it, expect } from "vitest";
import {
  envSchema,
  EXAMPLE_JWT_ACCESS_SECRET,
  EXAMPLE_JWT_REFRESH_SECRET,
} from "../src/common/config/config.service.js";
import { PrismaService } from "../src/common/database/prisma.service.js";

describe("Production Configuration & Database Role Hardening", () => {
  const baseValidProdEnv = {
    NODE_ENV: "production",
    PORT: "4000",
    DATABASE_URL: "postgresql://pos_runtime:secret123@postgres:5432/universal_pos",
    REDIS_URL: "redis://redis:6379",
    JWT_ACCESS_SECRET: "c841a0b1297e4e138bebf3b7596b42b781682390a3c242ef9a02347192837461",
    JWT_REFRESH_SECRET: "d952b1c2308f5f249cfcf4c8607c53c892793401b4d353fa0b13458203948572",
    CORS_ORIGINS: "https://pos.artisan.com",
  };

  it("accepts valid production configuration", () => {
    const result = envSchema.safeParse(baseValidProdEnv);
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

  it("refuses to start when JWT_ACCESS_SECRET equals the default value from .env.example", () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      JWT_ACCESS_SECRET: EXAMPLE_JWT_ACCESS_SECRET,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(
        msgs.some((m) => m.includes("cannot equal default .env.example value")),
      ).toBe(true);
    }
  });

  it("refuses to start when JWT_REFRESH_SECRET equals the default value from .env.example", () => {
    const result = envSchema.safeParse({
      ...baseValidProdEnv,
      JWT_REFRESH_SECRET: EXAMPLE_JWT_REFRESH_SECRET,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msgs = result.error.errors.map((e) => e.message);
      expect(
        msgs.some((m) => m.includes("cannot equal default .env.example value")),
      ).toBe(true);
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

  it("runtime database user cannot BYPASSRLS and is not a superuser", async () => {
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
