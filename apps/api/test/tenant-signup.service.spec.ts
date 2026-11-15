import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { ConflictException, BadRequestException } from "@nestjs/common";

describe("TenantsService Signup Unit Tests", () => {
  let tenantsService: TenantsService;
  let mockSystemDb: any;

  beforeEach(() => {
    mockSystemDb = {
      findTenantBySlug: vi.fn(),
      createTenantWithInitialData: vi.fn(),
    };
    tenantsService = new TenantsService(mockSystemDb);
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
    mockSystemDb.findTenantBySlug.mockResolvedValue({
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

  it("creates tenant via SystemDbService transaction", async () => {
    mockSystemDb.findTenantBySlug.mockResolvedValue(null);
    mockSystemDb.createTenantWithInitialData.mockResolvedValue({
      tenantId: "tenant-new-1",
      slug: "deshi-fashion",
      companyName: "Deshi Fashion",
      branchId: "branch-new-1",
      ownerId: "user-owner-1",
      ownerEmail: "habib@deshifashion.com",
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
    expect(mockSystemDb.createTenantWithInitialData).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: "Deshi Fashion",
        slug: "deshi-fashion",
        businessType: "fashion",
      }),
    );
  });
});
