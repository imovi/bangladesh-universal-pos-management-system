import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

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
    RATE_LIMIT_TTL: z.coerce.number().default(60),
    RATE_LIMIT_LIMIT: z.coerce.number().default(100),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000,http://localhost:3001"),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV === "production") {
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
