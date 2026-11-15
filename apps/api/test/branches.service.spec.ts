import { describe, it, expect, vi, beforeEach } from "vitest";
import { BranchesService } from "../src/modules/branches/branches.service.js";
import { ConflictException, NotFoundException } from "@nestjs/common";

describe("BranchesService", () => {
  let service: BranchesService;
  let mockPrisma: any;
  let mockAudit: any;

  const tenantId = "tenant-1";

  beforeEach(() => {
    mockPrisma = {
      branch: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    mockAudit = { log: vi.fn().mockResolvedValue(true) };
    service = new BranchesService(mockPrisma, mockAudit);
  });

  it("lists branches with pagination", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([{ id: "b1", name: "Main" }]);
    mockPrisma.branch.count.mockResolvedValue(1);

    const res = await service.findMany(tenantId, 1, 20);
    expect(res.items).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
  });

  it("throws NotFoundException when branch not found", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null);
    await expect(service.findById(tenantId, "non-existent")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates branch and writes audit log", async () => {
    mockPrisma.branch.findUnique.mockResolvedValue(null);
    mockPrisma.branch.create.mockResolvedValue({
      id: "b1",
      name: "Gulshan",
      code: "GUL-01",
    });

    const res = await service.create(tenantId, {
      name: "Gulshan",
      code: "GUL-01",
    });
    expect(res.id).toBe("b1");
    expect(mockAudit.log).toHaveBeenCalled();
  });

  it("rejects duplicate branch code in same tenant", async () => {
    mockPrisma.branch.findUnique.mockResolvedValue({ id: "existing" });
    await expect(
      service.create(tenantId, { name: "Gulshan", code: "GUL-01" }),
    ).rejects.toThrow(ConflictException);
  });

  it("updates branch successfully", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({
      id: "b1",
      name: "Old",
      code: "OLD-01",
      isActive: true,
    });
    mockPrisma.branch.findUnique.mockResolvedValue(null);
    mockPrisma.branch.update.mockResolvedValue({
      id: "b1",
      name: "New",
      code: "NEW-01",
      isActive: true,
    });

    const updated = await service.update(tenantId, "b1", {
      name: "New",
      code: "NEW-01",
    });
    expect(updated.name).toBe("New");
    expect(mockAudit.log).toHaveBeenCalled();
  });
});
