import { describe, it, expect } from "vitest";
import {
  TenantSignupSchema,
  LoginSchema,
  CreateBranchSchema,
  CreateUserSchema,
  CreateRoleSchema,
} from "@universal-pos/shared";

describe("Shared Zod Schemas Validation", () => {
  describe("TenantSignupSchema", () => {
    it("accepts valid signup payload", () => {
      const valid = {
        companyName: "Aarong Lifestyle",
        slug: "aarong-lifestyle",
        businessType: "fashion",
        owner: {
          name: "Habibur Rahman",
          email: "habib@aarong.com",
          phone: "+8801711223344",
          password: "Password123!",
        },
        branch: {
          name: "Gulshan Outlet",
          code: "GUL-01",
          address: "Gulshan Circle 1",
        },
      };

      const result = TenantSignupSchema.safeParse(valid);
      expect(result.success).toBe(true);
    });

    it("rejects invalid slug with uppercase letters or special characters", () => {
      const invalid = {
        companyName: "Test Shop",
        slug: "Test_Shop!",
        businessType: "retail",
        owner: {
          name: "Test",
          email: "test@shop.com",
          phone: "01700000000",
          password: "Password123!",
        },
        branch: {
          name: "Main",
          code: "MAIN-01",
        },
      };

      const result = TenantSignupSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects weak passwords missing uppercase or numbers", () => {
      const invalid = {
        companyName: "Test Shop",
        slug: "test-shop",
        businessType: "retail",
        owner: {
          name: "Test",
          email: "test@shop.com",
          phone: "01700000000",
          password: "weakpassword",
        },
        branch: {
          name: "Main",
          code: "MAIN-01",
        },
      };

      const result = TenantSignupSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("LoginSchema", () => {
    it("validates proper login credentials", () => {
      const valid = {
        tenantSlug: "aarong",
        email: "user@aarong.com",
        password: "Password123!",
      };
      expect(LoginSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects invalid email format", () => {
      const invalid = {
        tenantSlug: "aarong",
        email: "not-an-email",
        password: "Password123!",
      };
      expect(LoginSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("CreateBranchSchema", () => {
    it("accepts alphanumeric branch codes", () => {
      const valid = {
        name: "Dhanmondi Branch",
        code: "DHD-01",
        address: "Road 27",
      };
      expect(CreateBranchSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects invalid branch code symbols", () => {
      const invalid = {
        name: "Dhanmondi Branch",
        code: "DHD @ 01",
      };
      expect(CreateBranchSchema.safeParse(invalid).success).toBe(false);
    });
  });

  describe("CreateRoleSchema", () => {
    it("requires at least one permission key", () => {
      const invalid = {
        name: "Empty Role",
        permissionKeys: [],
      };
      expect(CreateRoleSchema.safeParse(invalid).success).toBe(false);
    });
  });
});
