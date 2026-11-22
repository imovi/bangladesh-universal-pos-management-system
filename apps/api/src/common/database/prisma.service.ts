import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const url =
      process.env.NODE_ENV === "test" && process.env.TEST_DATABASE_URL
        ? process.env.TEST_DATABASE_URL
        : process.env.DATABASE_URL;

    super(
      url
        ? {
            datasources: {
              db: { url },
            },
          }
        : undefined,
    );
  }

  async onModuleInit() {
    await this.$connect();
    if (process.env.NODE_ENV === "production") {
      try {
        const res = await this.$queryRaw<Array<{ is_superuser: string }>>`SELECT current_setting('is_superuser') AS is_superuser`;
        if (res && res[0] && res[0].is_superuser === "on") {
          throw new Error(
            "FATAL: Database connection user is a PostgreSQL superuser. Production requires a restricted runtime user (e.g. pos_runtime)."
          );
        }
      } catch (err: any) {
        if (err.message?.includes("FATAL:")) {
          throw err;
        }
        // Fallback check on pg_roles if current_setting is unavailable
        const roleRes = await this.$queryRaw<Array<{ rolsuper: boolean }>>`SELECT rolsuper FROM pg_roles WHERE rolname = CURRENT_USER`;
        if (roleRes && roleRes[0] && roleRes[0].rolsuper) {
          throw new Error(
            "FATAL: Database connection user is a PostgreSQL superuser. Production requires a restricted runtime user (e.g. pos_runtime)."
          );
        }
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
