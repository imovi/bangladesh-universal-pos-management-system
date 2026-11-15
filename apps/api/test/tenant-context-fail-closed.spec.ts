import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { TenantContextService } from '../src/common/database/tenant-context.service.js';
import { createTestPrismaClient } from './test-db-helper.js';

describe('Fix 3: Fail-Closed Tenant Context', () => {
  let prisma: PrismaClient;
  let service: TenantContextService;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
    service = new TenantContextService(prisma as any);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('rejects if tenantId is not a valid UUID', async () => {
    await expect(
      service.runWithTenant('invalid-non-uuid', async (tx) => {
        return tx.user.findMany();
      }),
    ).rejects.toThrow(/Invalid tenantId: must be a valid UUID/);
  });

  it('switches to pos_app role and enforces RLS in transaction', async () => {
    const validUuid = '0193309a-6b21-7000-8000-000000000001';

    const result = await service.runWithTenant(validUuid, async (tx) => {
      const currentRole: any[] = await tx.$queryRaw`SELECT current_user, session_user;`;
      const currentTenant: any[] = await tx.$queryRaw`SELECT current_setting('app.tenant_id', true);`;
      return { currentRole, currentTenant };
    });

    expect(result.currentRole[0].current_user).toBe('pos_app');
    expect(result.currentTenant[0].current_setting).toBe(validUuid);
  });

  it('fails closed when setting an invalid role without falling back to superuser', async () => {
    const validUuid = '0193309a-6b21-7000-8000-000000000001';

    // Mock Prisma transaction to fail on SET LOCAL ROLE
    const failingPrisma: any = {
      $transaction: async (cb: any) => {
        const mockTx: any = {
          $executeRaw: async () => {
            throw new Error('role "non_existent_role" does not exist');
          },
        };
        return cb(mockTx);
      },
    };

    const failingService = new TenantContextService(failingPrisma);

    await expect(
      failingService.runWithTenant(validUuid, async () => {
        return 'should-never-reach-here';
      }),
    ).rejects.toThrow(/role "non_existent_role" does not exist/);
  });
});
