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
      // 1. Check superuser status via current_setting
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
      }

      // 2. Check pg_roles for rolsuper and rolbypassrls
      const roleRes = await this.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = CURRENT_USER`;
      if (roleRes && roleRes[0]) {
        if (roleRes[0].rolsuper) {
          throw new Error(
            "FATAL: Database connection user is a PostgreSQL superuser. Production requires a restricted runtime user (e.g. pos_runtime)."
          );
        }
        if (roleRes[0].rolbypassrls) {
          throw new Error(
            "FATAL: Database connection user has BYPASSRLS privilege. Production requires RLS enforcement."
          );
        }
      }

      // 3. Check table ownership in public schema
      const tablesRes = await this.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM pg_tables WHERE schemaname = 'public' AND tableowner = CURRENT_USER`;
      const ownedCount = Number(tablesRes?.[0]?.count ?? 0n);
      if (ownedCount > 0) {
        throw new Error(
          "FATAL: Database connection user owns tables in public schema, bypassing RLS. Production runtime user must not own tables."
        );
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
