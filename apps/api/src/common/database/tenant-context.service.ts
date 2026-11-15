import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { Prisma } from '@prisma/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TenantContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs an operation with PostgreSQL Row Level Security (RLS) configured for the tenant.
   * Fails closed: if SET LOCAL ROLE pos_app fails or tenantId is invalid, transaction fails immediately.
   */
  async runWithTenant<T>(
    tenantId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!tenantId || !UUID_REGEX.test(tenantId)) {
      throw new BadRequestException('Invalid tenantId: must be a valid UUID');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Switch to unprivileged role pos_app (strictly fail-closed, no try/catch)
        await tx.$executeRaw`SET LOCAL ROLE pos_app;`;

        // 2. Set parameterised session variable for tenant_id (is_local = true)
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true);`;

        // 3. Execute business logic within isolation boundary
        return operation(tx);
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );
  }
}
