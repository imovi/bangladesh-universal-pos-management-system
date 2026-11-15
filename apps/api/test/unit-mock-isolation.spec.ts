import { describe, it, expect, vi, beforeEach } from "vitest";
import { BranchesService } from "../src/modules/branches/branches.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { RolesService } from "../src/modules/roles/roles.service.js";
import {
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";

describe("Unit Mock Scope Check (Renamed from tenant-isolation)", () => {
  let mockPrisma: any;
  let mockAudit: any;
  let mockTenantContext: any;
  let branchesService: BranchesService;
  let rolesService: RolesService;

  const TENANT_A = "11111111-1111-1111-1111-111111111111";

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
      user: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
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

    branchesService = new BranchesService(mockTenantContext, mockAudit);
    rolesService = new RolesService(mockTenantContext, mockAudit);
  });

  it("branches query passes where: { tenantId } as second layer defense", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([]);
    mockPrisma.branch.count.mockResolvedValue(0);

    await branchesService.findMany(TENANT_A, 1, 20);

    expect(mockPrisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_A },
      }),
    );
  });

  it("cannot find branch when null returned", async () => {
    mockPrisma.branch.findFirst.mockResolvedValue(null);

    await expect(
      branchesService.findById(TENANT_A, "branch-not-found"),
    ).rejects.toThrow(NotFoundException);
  });

  it("prevents modifying or deleting system roles (Owner, Manager, etc.)", async () => {
    mockPrisma.role.findFirst.mockResolvedValue({
      id: "role-owner",
      tenantId: TENANT_A,
      name: "Owner",
      isSystem: true,
    });

    await expect(
      rolesService.delete(TENANT_A, "role-owner"),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      rolesService.update(TENANT_A, "role-owner", { name: "New Owner Name" }),
    ).rejects.toThrow(ForbiddenException);
  });
});
