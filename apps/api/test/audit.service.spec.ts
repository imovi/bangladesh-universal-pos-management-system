import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditService } from "../src/modules/audit/audit.service.js";

describe("AuditService", () => {
  let service: AuditService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
      },
    };
    service = new AuditService(mockPrisma);
  });

  it("records audit log with before/after snapshots", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({ id: "log-1" });

    const log = await service.log({
      tenantId: "tenant-1",
      actorUserId: "user-1",
      action: "branch.create",
      entityType: "Branch",
      entityId: "branch-1",
      after: { name: "Main" },
      ip: "127.0.0.1",
    });

    expect(log.id).toBe("log-1");
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        action: "branch.create",
        ip: "127.0.0.1",
      }),
    });
  });

  it("queries audit logs with pagination and filters", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ id: "log-1" }]);
    mockPrisma.auditLog.count.mockResolvedValue(1);

    const res = await service.findMany("tenant-1", {
      page: 1,
      limit: 10,
      entityType: "Branch",
    });
    expect(res.items).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
  });
});
