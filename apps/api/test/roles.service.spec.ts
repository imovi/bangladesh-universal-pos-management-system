import { describe, it, expect, vi, beforeEach } from "vitest";
import { RolesService } from "../src/modules/roles/roles.service.js";
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";

describe("RolesService", () => {
  let service: RolesService;
  let mockPrisma: any;
  let mockAudit: any;

  const tenantId = "tenant-1";

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
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: any) => any) => fn(mockPrisma)),
    };
    mockAudit = { log: vi.fn().mockResolvedValue(true) };
    service = new RolesService(mockPrisma, mockAudit);
  });

  it("lists all roles for tenant", async () => {
    mockPrisma.role.findMany.mockResolvedValue([{ id: "r1", name: "Cashier" }]);
    const res = await service.findMany(tenantId);
    expect(res).toHaveLength(1);
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

    const updated = await service.update(tenantId, "r-custom", {
      name: "Updated Role",
      permissionKeys: ["sale.create"],
    });

    expect(mockPrisma.rolePermission.deleteMany).toHaveBeenCalled();
    expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
    expect(mockAudit.log).toHaveBeenCalled();
  });
});
