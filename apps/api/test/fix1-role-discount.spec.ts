import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { PERMISSIONS } from "@universal-pos/shared";

describe("Fix 1: Role without discount limit means 0%", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;
  let branchId: string;
  let registerId: string;
  let openShiftId: string;
  let variantId: string;

  beforeAll(async () => {
    await truncateTestDatabase();
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    systemDb = app.get(SystemDbService);

    // 1. Provision tenant & owner
    const signup = await tenantsService.signup({
      companyName: "Fix1 Fashion Shop",
      slug: "fix1-shop",
      businessType: "fashion",
      owner: {
        name: "Fix1 Owner",
        email: "owner@fix1.com",
        phone: "+8801700000051",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
    });

    const ownerLogin = await authService.login({
      tenantSlug: "fix1-shop",
      email: "owner@fix1.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    // 2. Setup product & inventory
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Fix1 Denim Jeans",
        sku: "FIX1-JEANS",
        priceMinor: 100000, // ৳ 1000.00
        costMinor: 50000,
      });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, unitCostMinor: 50000 }],
      });

    // 3. Register & Shift
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        name: "Counter 1",
        code: "CTR-01",
      });
    registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 100000,
      });
    openShiftId = shiftRes.body.data.id;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("custom role created without maxDiscountPercent gets 0% and rejects a 1% discount with 403", async () => {
    // Create role without maxDiscountPercent
    const createRoleRes = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Zero Discount Trainee",
        permissionKeys: [
          PERMISSIONS.SALE_READ,
          PERMISSIONS.SALE_CREATE,
          PERMISSIONS.BRANCH_READ,
          PERMISSIONS.CATALOG_READ,
        ],
      });
    expect(createRoleRes.status).toBe(201);
    expect(createRoleRes.body.data.maxDiscountPercent).toBe(0);
    const zeroRoleId = createRoleRes.body.data.id;

    // Create user with only this role
    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Zero Discount User",
        email: "zero@fix1.com",
        password: "Password123!",
        roleIds: [zeroRoleId],
      });

    const loginRes = await authService.login({
      tenantSlug: "fix1-shop",
      email: "zero@fix1.com",
      password: "Password123!",
    });
    const traineeToken = loginRes.accessToken;

    // Attempt 1% discount (100 bp) -> must be rejected with 403
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${traineeToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000001")
      .send({
        id: "0193309a-6b21-7000-8000-000000000001",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 100 }, // 1%
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 99000 }],
        expectedTotalMinor: 99000,
      });

    expect(saleRes.status).toBe(403);
  });

  it("user with two roles (5% and 20%) can give 20% discount", async () => {
    // Create two roles without discount_override permission: 5% and 20%
    const role5Res = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Tier 1 Cashier (5%)",
        maxDiscountPercent: 5,
        permissionKeys: [
          PERMISSIONS.SALE_READ,
          PERMISSIONS.SALE_CREATE,
          PERMISSIONS.BRANCH_READ,
          PERMISSIONS.CATALOG_READ,
        ],
      });
    expect(role5Res.status).toBe(201);

    const role20Res = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Tier 2 Lead (20%)",
        maxDiscountPercent: 20,
        permissionKeys: [
          PERMISSIONS.SALE_READ,
          PERMISSIONS.SALE_CREATE,
          PERMISSIONS.BRANCH_READ,
          PERMISSIONS.CATALOG_READ,
        ],
      });
    expect(role20Res.status).toBe(201);

    // Create user with both roles
    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Dual Role User",
        email: "dual@fix1.com",
        password: "Password123!",
        roleIds: [role5Res.body.data.id, role20Res.body.data.id],
      });

    const loginRes = await authService.login({
      tenantSlug: "fix1-shop",
      email: "dual@fix1.com",
      password: "Password123!",
    });
    const dualToken = loginRes.accessToken;

    // 20% discount should succeed
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${dualToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000002")
      .send({
        id: "0193309a-6b21-7000-8000-000000000002",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 2000 }, // 20%
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 80000 }],
        expectedTotalMinor: 80000,
      });

    expect(saleRes.status).toBe(201);

    // 25% discount should be rejected
    const overRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${dualToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000003")
      .send({
        id: "0193309a-6b21-7000-8000-000000000003",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 2500 }, // 25%
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 75000 }],
        expectedTotalMinor: 75000,
      });

    expect(overRes.status).toBe(403);
  });

  it("owner can give 100% discount", async () => {
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000004")
      .send({
        id: "0193309a-6b21-7000-8000-000000000004",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 10000 }, // 100%
          },
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
        expectedTotalMinor: 100000,
      });

    expect(saleRes.status).toBe(201);
  });

  it("PATCH a role with only a new name leaves maxDiscountPercent unchanged", async () => {
    // Create role with 15% discount
    const createRoleRes = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Senior Cashier Initial",
        maxDiscountPercent: 15,
        permissionKeys: [PERMISSIONS.SALE_READ, PERMISSIONS.SALE_CREATE],
      });
    expect(createRoleRes.status).toBe(201);
    expect(createRoleRes.body.data.maxDiscountPercent).toBe(15);
    const roleId = createRoleRes.body.data.id;

    // PATCH with only new name
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/roles/${roleId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Senior Cashier Renamed",
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.name).toBe("Senior Cashier Renamed");
    expect(patchRes.body.data.maxDiscountPercent).toBe(15);

    // Verify GET also returns 15
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/roles/${roleId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.maxDiscountPercent).toBe(15);
  });
});
