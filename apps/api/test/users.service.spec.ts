import { describe, it, expect, vi, beforeEach } from "vitest";
import { UsersService } from "../src/modules/users/users.service.js";
import { ConflictException, NotFoundException } from "@nestjs/common";

describe("UsersService Unit Tests", () => {
  let service: UsersService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockTenantContext: any;

  const tenantId = "0193309a-6b21-7000-8000-000000000001";

  beforeEach(() => {
    mockPrisma = {
      user: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      userRole: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      userBranch: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
    };
    mockAudit = { log: vi.fn().mockResolvedValue(true) };
    mockTenantContext = {
      runWithTenant: vi
        .fn()
        .mockImplementation((_id, fn) => fn(mockPrisma)),
    };
    service = new UsersService(mockTenantContext, mockAudit);
  });

  it("lists users with pagination", async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: "u1", name: "User 1" }]);
    mockPrisma.user.count.mockResolvedValue(1);

    const res = await service.findMany(tenantId, 1, 10);
    expect(res.items).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
    expect(mockTenantContext.runWithTenant).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
    );
  });

  it("throws NotFoundException when user not found", async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);
    await expect(service.findById(tenantId, "non-existent")).rejects.toThrow(
      NotFoundException,
    );
  });

  it("creates user with roles and branch assignments", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: "u-created",
      email: "test@pos.com",
      name: "Test",
    });
    mockPrisma.user.findFirst.mockResolvedValue({
      id: "u-created",
      email: "test@pos.com",
      name: "Test",
    });

    const created = await service.create(tenantId, {
      name: "Test",
      email: "test@pos.com",
      password: "Password123!",
      roleIds: ["role-1"],
      branchIds: ["branch-1"],
    });

    expect(created.id).toBe("u-created");
    expect(mockPrisma.userRole.createMany).toHaveBeenCalled();
    expect(mockPrisma.userBranch.createMany).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalled();
  });

  it("rejects duplicate email in the same tenant", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "existing" });

    await expect(
      service.create(tenantId, {
        name: "Test",
        email: "test@pos.com",
        password: "Password123!",
        roleIds: ["role-1"],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("updates user attributes and reassigns roles/branches", async () => {
    mockPrisma.user.findFirst
      .mockResolvedValueOnce({ id: "u1", name: "Old Name", isActive: true })
      .mockResolvedValueOnce({ id: "u1", name: "New Name", isActive: false });
    mockPrisma.user.update.mockResolvedValue({
      id: "u1",
      name: "New Name",
      isActive: false,
    });

    const updated = await service.update(tenantId, "u1", {
      name: "New Name",
      isActive: false,
      roleIds: ["role-new"],
      branchIds: ["branch-new"],
    });

    expect(updated.name).toBe("New Name");
    expect(mockPrisma.userRole.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.userRole.createMany).toHaveBeenCalled();
    expect(mockPrisma.userBranch.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.userBranch.createMany).toHaveBeenCalled();
  });
});
