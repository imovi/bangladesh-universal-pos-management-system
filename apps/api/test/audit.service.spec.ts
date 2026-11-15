import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditService } from "../src/modules/audit/audit.service.js";

describe("AuditService Unit Tests", () => {
  let service: AuditService;
  let mockPrisma: any;
  let mockTenantContext: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    mockTenantContext = {
      runWithTenant: vi
        .fn()
        .mockImplementation((_id, fn) => fn(mockPrisma)),
    };
    service = new AuditService(mockTenantContext);
  });

  it("records audit log with before/after snapshots", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({ id: "log-1" });

    const log = await service.log({
      tenantId: "0193309a-6b21-7000-8000-000000000001",
      actorUserId: "user-1",
      action: "branch.create",
      entityType: "Branch",
      entityId: "branch-1",
      after: { name: "Main" },
      ip: "127.0.0.1",
    });

    expect(log.id).toBe("log-1");
    expect(mockTenantContext.runWithTenant).toHaveBeenCalled();
  });

  it("queries audit logs with pagination and filters", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ id: "log-1" }]);
    mockPrisma.auditLog.count.mockResolvedValue(1);

    const res = await service.findMany(
      "0193309a-6b21-7000-8000-000000000001",
      { page: 1, limit: 10, entityType: "Branch" },
    );
    expect(res.items).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
  });
});
