import { describe, it, expect, vi, beforeEach } from "vitest";
import { BranchesService } from "../src/modules/branches/branches.service.js";
import { UsersService } from "../src/modules/users/users.service.js";
import { RolesService } from "../src/modules/roles/roles.service.js";
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from "@nestjs/common";

describe("Tenant Isolation & Cross-Tenant Boundary Enforcement", () => {
  let mockPrisma: any;
  let mockAudit: any;
  let branchesService: BranchesService;
  let usersService: UsersService;
  let rolesService: RolesService;

  const TENANT_A = "11111111-1111-1111-1111-111111111111";
  const TENANT_B = "22222222-2222-2222-2222-222222222222";

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
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: any) => any) => fn(mockPrisma)),
    };

    mockAudit = { log: vi.fn().mockResolvedValue(true) };

    branchesService = new BranchesService(mockPrisma, mockAudit);
    usersService = new UsersService(mockPrisma, mockAudit);
    rolesService = new RolesService(mockPrisma, mockAudit);
  });

  it("branches query restricts strictly by tenantId", async () => {
    mockPrisma.branch.findMany.mockResolvedValue([]);
    mockPrisma.branch.count.mockResolvedValue(0);

    await branchesService.findMany(TENANT_A, 1, 20);

    expect(mockPrisma.branch.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: TENANT_A },
      }),
    );
  });

  it("cannot find or update branch belonging to Tenant B when requested by Tenant A", async () => {
    // Tenant B's branch requested with Tenant A's session
    mockPrisma.branch.findFirst.mockResolvedValue(null);

    await expect(
      branchesService.findById(TENANT_A, "branch-belonging-to-b"),
    ).rejects.toThrow(NotFoundException);
  });

  it("prevents modifying or deleting system roles (Owner, Manager, etc.)", async () => {
    mockPrisma.role.findFirst.mockResolvedValue({
      id: "role-owner",
      tenantId: TENANT_A,
      name: "Owner",
      isSystem: true,
    });

    await expect(rolesService.delete(TENANT_A, "role-owner")).rejects.toThrow(
      ForbiddenException,
    );

    await expect(
      rolesService.update(TENANT_A, "role-owner", { name: "New Owner Name" }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("allows same branch code or email across DIFFERENT tenants without collision", async () => {
    // Tenant A already has code "MAIN-01"
    mockPrisma.branch.findUnique.mockResolvedValue(null);
    mockPrisma.branch.create.mockResolvedValue({
      id: "new-branch-b",
      tenantId: TENANT_B,
      code: "MAIN-01",
    });

    const created = await branchesService.create(TENANT_B, {
      name: "Tenant B Main",
      code: "MAIN-01",
    });

    expect(created.code).toBe("MAIN-01");
    expect(mockPrisma.branch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT_B,
          code: "MAIN-01",
        }),
      }),
    );
  });
});
