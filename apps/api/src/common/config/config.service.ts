import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

export const FORBIDDEN_JWT_SECRETS: readonly string[] = [
  "super-secret-access-key-change-me-in-production-min-32-chars",
  "super-secret-refresh-key-change-me-in-production-min-32-chars",
  "super-secret-platform-key-change-me-in-production-min-32-chars",
  "replace-with-generated-jwt-access-secret-min-32-chars",
  "replace-with-generated-jwt-refresh-secret-min-32-chars",
  "replace-with-generated-platform-jwt-secret-min-32-chars",
] as const;

export const EXAMPLE_JWT_ACCESS_SECRET = FORBIDDEN_JWT_SECRETS[0];
export const EXAMPLE_JWT_REFRESH_SECRET = FORBIDDEN_JWT_SECRETS[1];
export const EXAMPLE_PLATFORM_JWT_SECRET = FORBIDDEN_JWT_SECRETS[2];

function containsPlaceholderPattern(val: string): boolean {
  if (!val || typeof val !== "string") return false;
  const lower = val.toLowerCase();
  return lower.includes("replace-with") || lower.includes("change-me") || lower.includes("example");
}

function extractDatabasePassword(urlStr: string): string {
  if (!urlStr || typeof urlStr !== "string") return "";
  try {
    const parsed = new URL(urlStr);
    return parsed.password ? decodeURIComponent(parsed.password) : "";
  } catch {
    const match = urlStr.match(/:([^@/:]+)@/);
    return match ? match[1] : "";
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    TEST_DATABASE_URL: z.string().optional(),
    MIGRATION_DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),
    PLATFORM_JWT_SECRET: z
      .string()
      .min(32, "PLATFORM_JWT_SECRET must be at least 32 characters")
      .default("super-secret-platform-key-change-me-in-production-min-32-chars"),
    PLATFORM_JWT_EXPIRES_IN: z.string().default("30m"),
    RATE_LIMIT_TTL: z.coerce.number().default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().default(100),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001"),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production") {
      // 1. JWT Access Secret checks
      if (!data.JWT_ACCESS_SECRET || Buffer.byteLength(data.JWT_ACCESS_SECRET, "utf8") < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_ACCESS_SECRET"],
          message: "JWT_ACCESS_SECRET must be at least 32 bytes in production",
        });
      }
      if (containsPlaceholderPattern(data.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_ACCESS_SECRET"],
          message: "JWT_ACCESS_SECRET cannot contain placeholder patterns (replace-with, change-me, example) in production",
        });
      }
      if (FORBIDDEN_JWT_SECRETS.includes(data.JWT_ACCESS_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_ACCESS_SECRET"],
          message: "JWT_ACCESS_SECRET cannot equal default example placeholder values in production",
        });
      }

      // 2. JWT Refresh Secret checks
      if (!data.JWT_REFRESH_SECRET || Buffer.byteLength(data.JWT_REFRESH_SECRET, "utf8") < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_REFRESH_SECRET"],
          message: "JWT_REFRESH_SECRET must be at least 32 bytes in production",
        });
      }
      if (containsPlaceholderPattern(data.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_REFRESH_SECRET"],
          message: "JWT_REFRESH_SECRET cannot contain placeholder patterns (replace-with, change-me, example) in production",
        });
      }
      if (FORBIDDEN_JWT_SECRETS.includes(data.JWT_REFRESH_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_REFRESH_SECRET"],
          message: "JWT_REFRESH_SECRET cannot equal default example placeholder values in production",
        });
      }

      // 3. Platform JWT Secret checks
      if (!data.PLATFORM_JWT_SECRET || Buffer.byteLength(data.PLATFORM_JWT_SECRET, "utf8") < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PLATFORM_JWT_SECRET"],
          message: "PLATFORM_JWT_SECRET must be at least 32 bytes in production",
        });
      }
      if (containsPlaceholderPattern(data.PLATFORM_JWT_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PLATFORM_JWT_SECRET"],
          message: "PLATFORM_JWT_SECRET cannot contain placeholder patterns (replace-with, change-me, example) in production",
        });
      }
      if (FORBIDDEN_JWT_SECRETS.includes(data.PLATFORM_JWT_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PLATFORM_JWT_SECRET"],
          message: "PLATFORM_JWT_SECRET cannot equal default example placeholder values in production",
        });
      }

      // 4. Reject equal access, refresh, or platform secrets
      if (
        data.JWT_ACCESS_SECRET &&
        data.JWT_REFRESH_SECRET &&
        data.JWT_ACCESS_SECRET === data.JWT_REFRESH_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_REFRESH_SECRET"],
          message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET cannot be identical in production",
        });
      }
      if (
        data.JWT_ACCESS_SECRET &&
        data.PLATFORM_JWT_SECRET &&
        data.JWT_ACCESS_SECRET === data.PLATFORM_JWT_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PLATFORM_JWT_SECRET"],
          message: "JWT_ACCESS_SECRET and PLATFORM_JWT_SECRET cannot be identical in production",
        });
      }
      if (
        data.JWT_REFRESH_SECRET &&
        data.PLATFORM_JWT_SECRET &&
        data.JWT_REFRESH_SECRET === data.PLATFORM_JWT_SECRET
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PLATFORM_JWT_SECRET"],
          message: "JWT_REFRESH_SECRET and PLATFORM_JWT_SECRET cannot be identical in production",
        });
      }

      // 5. Reject weak or placeholder database password
      const dbPassword = extractDatabasePassword(data.DATABASE_URL);
      const lowerPw = dbPassword.toLowerCase();
      if (
        lowerPw === "pos_secret" ||
        lowerPw === "pos_runtime_secret" ||
        lowerPw.includes("replace-with")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["DATABASE_URL"],
          message: "DATABASE_URL cannot use weak or placeholder passwords (pos_secret, pos_runtime_secret, replace-with) in production",
        });
      }

      // 5. CORS checks
      const trimmed = data.CORS_ORIGINS?.trim() || "";
      if (
        !trimmed ||
        trimmed.split(",").some((origin) => origin.trim() === "*")
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CORS_ORIGINS"],
          message:
            "CORS_ORIGINS must be set to explicit domains and cannot contain wildcard (*) in production",
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  private readonly config: EnvConfig;

  constructor() {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const invalidKeys = Object.keys(result.error.flatten().fieldErrors);
      this.logger.error(
        `Invalid or missing environment variables: ${invalidKeys.join(", ")}`,
      );
      throw new Error(
        `Config validation error: invalid keys [${invalidKeys.join(", ")}]`,
      );
    }
    this.config = result.data;
  }

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config[key];
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === "production";
  }

  get isTest(): boolean {
    return this.config.NODE_ENV === "test";
  }

  get corsOrigins(): string[] {
    return this.config.CORS_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
}
