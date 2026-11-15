import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { SYSTEM_ROLES } from "@universal-pos/shared";

describe("TenantsService Signup & Role Seeding", () => {
  let tenantsService: TenantsService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      tenant: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      branch: {
        create: vi.fn(),
      },
      role: {
        create: vi.fn(),
      },
      rolePermission: {
        createMany: vi.fn(),
      },
      user: {
        create: vi.fn(),
      },
      userRole: {
        create: vi.fn(),
      },
      userBranch: {
        create: vi.fn(),
      },
      $transaction: vi
        .fn()
        .mockImplementation((fn: (tx: any) => any) => fn(mockPrisma)),
    };

    mockAudit = { log: vi.fn().mockResolvedValue(true) };
    tenantsService = new TenantsService(mockPrisma, mockAudit);
  });

  it("rejects invalid payload format", async () => {
    await expect(
      tenantsService.signup({
        companyName: "",
        slug: "invalid_slug!",
        businessType: "fashion",
        owner: {} as any,
        branch: {} as any,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects signup if tenant slug already taken", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({
      id: "existing-tenant-id",
    });

    await expect(
      tenantsService.signup({
        companyName: "Aarong",
        slug: "aarong",
        businessType: "fashion",
        owner: {
          name: "Habib",
          email: "habib@aarong.com",
          phone: "+8801700000000",
          password: "Password123!",
        },
        branch: {
          name: "Main",
          code: "MAIN-01",
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it("creates tenant, branch, owner user, and seeds all 4 system roles", async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({
      id: "tenant-new-1",
      name: "Deshi Fashion",
      slug: "deshi-fashion",
      businessType: "fashion",
    });
    mockPrisma.branch.create.mockResolvedValue({
      id: "branch-new-1",
      name: "Dhanmondi",
      code: "DHD-01",
    });
    mockPrisma.role.create.mockImplementation(({ data }: any) => ({
      id: `role-${data.name.toLowerCase()}`,
      name: data.name,
    }));
    mockPrisma.user.create.mockResolvedValue({
      id: "user-owner-1",
      email: "habib@deshifashion.com",
      name: "Habibur Rahman",
    });

    const result = await tenantsService.signup({
      companyName: "Deshi Fashion",
      slug: "deshi-fashion",
      businessType: "fashion",
      owner: {
        name: "Habibur Rahman",
        email: "habib@deshifashion.com",
        phone: "+8801700000000",
        password: "Password123!",
      },
      branch: {
        name: "Dhanmondi",
        code: "DHD-01",
      },
    });

    expect(result.slug).toBe("deshi-fashion");
    expect(result.ownerEmail).toBe("habib@deshifashion.com");
    // Ensure 4 system roles were created (Owner, Manager, Cashier, Store Keeper)
    expect(mockPrisma.role.create).toHaveBeenCalledTimes(4);
    expect(mockAudit.log).toHaveBeenCalled();
  });
});
