import { describe, it, expect, vi, beforeEach } from "vitest";
import { RolesService } from "../src/modules/roles/roles.service.js";
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";

describe("RolesService Unit Tests", () => {
  let service: RolesService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockTenantContext: any;

  const tenantId = "0193309a-6b21-7000-8000-000000000001";

  beforeEach(() => {
    mockPrisma = {
      role: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      rolePermission: {
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
    service = new RolesService(mockTenantContext, mockAudit);
  });

  it("lists all roles for tenant", async () => {
    mockPrisma.role.findMany.mockResolvedValue([{ id: "r1", name: "Cashier" }]);
    const res = await service.findMany(tenantId);
    expect(res).toHaveLength(1);
    expect(mockTenantContext.runWithTenant).toHaveBeenCalledWith(
      tenantId,
      expect.any(Function),
    );
  });

  it("creates custom role with permission assignments", async () => {
    mockPrisma.role.findUnique.mockResolvedValue(null);
    mockPrisma.role.create.mockResolvedValue({
      id: "r-custom",
      name: "Custom Role",
      isSystem: false,
    });

    const created = await service.create(tenantId, {
      name: "Custom Role",
      permissionKeys: ["sale.read"],
    });

    expect(created.name).toBe("Custom Role");
    expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
  });

  it("rejects duplicate role name in tenant", async () => {
    mockPrisma.role.findUnique.mockResolvedValue({ id: "existing" });
    await expect(
      service.create(tenantId, {
        name: "Manager",
        permissionKeys: ["sale.read"],
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("prevents deleting system role", async () => {
    mockPrisma.role.findFirst.mockResolvedValue({
      id: "sys-role",
      name: "Owner",
      isSystem: true,
    });
    await expect(service.delete(tenantId, "sys-role")).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("updates custom role permissions and name", async () => {
    mockPrisma.role.findFirst.mockResolvedValue({
      id: "r-custom",
      name: "Old Role",
      isSystem: false,
    });
    mockPrisma.role.findUnique.mockResolvedValue(null);
    mockPrisma.role.update.mockResolvedValue({
      id: "r-custom",
      name: "Updated Role",
    });

    await service.update(tenantId, "r-custom", {
      name: "Updated Role",
      permissionKeys: ["sale.create"],
    });

    expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalled();
  });
});
