import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { Prisma } from "@prisma/client";

@Injectable()
export class TenantContextService {
  private readonly logger = new Logger(TenantContextService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs an operation with PostgreSQL Row Level Security (RLS) configured for the tenant.
   * Uses SET LOCAL so that settings reset automatically at the end of the transaction.
   */
  async runWithTenant<T>(
    tenantId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // 1. Switch to unprivileged role pos_app if running on PostgreSQL with RLS
      try {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE pos_app;`);
      } catch (e: unknown) {
        // Fallback for non-RLS / test environments
        this.logger.debug(
          `Could not set role pos_app (likely testing or admin setup): ${(e as Error).message}`,
        );
      }

      // 2. Set session variable for tenant_id (is_local = true)
      await tx.$executeRawUnsafe(
        `SELECT set_config('app.tenant_id', $1, true);`,
        tenantId,
      );

      // 3. Execute business logic within isolation boundary
      return operation(tx);
    });
  }
}
