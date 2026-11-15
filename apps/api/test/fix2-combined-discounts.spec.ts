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

describe("Fix 2: Measure line and bill discounts together Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;
  let cashierToken: string;
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
      companyName: "Fix2 Combined Discount Outlet",
      slug: "fix2-discount",
      businessType: "fashion",
      owner: {
        name: "Fix2 Owner",
        email: "owner@fix2.com",
        phone: "+8801700000061",
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
      tenantSlug: "fix2-discount",
      email: "owner@fix2.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    // 2. Fetch default Cashier role (5% limit) and create Cashier user
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "5 Percent Cashier",
        email: "cashier@fix2.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const cashierLogin = await authService.login({
      tenantSlug: "fix2-discount",
      email: "cashier@fix2.com",
      password: "Password123!",
    });
    cashierToken = cashierLogin.accessToken;

    // 3. Setup product & opening inventory
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Classic Silk Shirt",
        sku: "SILK-SHIRT",
        priceMinor: 100000, // ৳ 1000.00 = 100,000 poisha
        costMinor: 40000,
      });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, unitCostMinor: 40000 }],
      });

    // 4. Register & open shift
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
      .set("Authorization", `Bearer ${cashierToken}`)
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

  it("5% cashier: 5% line discount + 0% bill discount is accepted (201)", async () => {
    // 5% on 100,000 = 5,000 poisha discount. Total = 95,000 poisha
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000011")
      .send({
        id: "0193309a-6b21-7000-8000-000000000011",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 500 }, // 5%
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 95000 }],
        expectedTotalMinor: 95000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.discountMinor).toBe(5000);
    expect(res.body.data.totalMinor).toBe(95000);
  });

  it("5% cashier: 5% line discount + 5% bill discount is rejected with 403 carrying limit and attempted bp", async () => {
    // Stacking 5% line + 5% bill results in 9,750 total discount (975 bp = 9.75% > 500 bp)
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000012")
      .send({
        id: "0193309a-6b21-7000-8000-000000000012",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 500 }, // 5%
          },
        ],
        billDiscount: { type: "percent", percentBp: 500 }, // 5%
        payments: [{ paymentMethod: "cash", amountMinor: 90250 }],
        expectedTotalMinor: 90250,
      });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DISCOUNT_LIMIT_EXCEEDED");
    expect(res.body.error.limitBp).toBe(500);
    expect(res.body.error.attemptedBp).toBe(975);
  });

  it("5% cashier: 3% line + 2% bill on single-line sale asserts exact 494 bp effective figure and outcome (201)", async () => {
    // 3% on 100,000 = 3,000 poisha line discount.
    // 2% bill on 97,000 = roundHalfUp(97,000 * 200, 10000) = 1,940 poisha.
    // Total discount = 4,940 poisha.
    // Effective bp = ceiling((4,940 * 10,000) / 100,000) = 494 bp (4.94% <= 5.00%).
    // Net total = 100,000 - 4,940 = 95,060 poisha.
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000013")
      .send({
        id: "0193309a-6b21-7000-8000-000000000013",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "percent", percentBp: 300 }, // 3%
          },
        ],
        billDiscount: { type: "percent", percentBp: 200 }, // 2%
        payments: [{ paymentMethod: "cash", amountMinor: 95060 }],
        expectedTotalMinor: 95060,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.discountMinor).toBe(4940);
    expect(res.body.data.totalMinor).toBe(95060);
  });

  it("5% cashier: fixed-amount and percent discounts mixed", async () => {
    // 1. Accepted: ৳ 20 (2,000 poisha) line discount + 2% bill discount
    // 2% on 98,000 = 1,960 poisha.
    // Total discount = 2,000 + 1,960 = 3,960 poisha.
    // Effective bp = ceiling((3,960 * 10,000) / 100,000) = 396 bp <= 500 bp -> 201
    const acceptRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000014")
      .send({
        id: "0193309a-6b21-7000-8000-000000000014",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "fixed", amountMinor: 2000 }, // ৳ 20
          },
        ],
        billDiscount: { type: "percent", percentBp: 200 }, // 2%
        payments: [{ paymentMethod: "cash", amountMinor: 96040 }],
        expectedTotalMinor: 96040,
      });

    expect(acceptRes.status).toBe(201);
    expect(acceptRes.body.data.discountMinor).toBe(3960);

    // 2. Rejected: ৳ 30 (3,000 poisha) line discount + ৳ 25 (2,500 poisha) fixed bill discount
    // Total discount = 5,500 poisha.
    // Effective bp = ceiling((5,500 * 10,000) / 100,000) = 550 bp > 500 bp -> 403
    const rejectRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", "0193309a-6b21-7000-8000-000000000015")
      .send({
        id: "0193309a-6b21-7000-8000-000000000015",
        branchId,
        shiftId: openShiftId,
        items: [
          {
            variantId,
            quantity: 1,
            unitPriceMinor: 100000,
            discount: { type: "fixed", amountMinor: 3000 }, // ৳ 30
          },
        ],
        billDiscount: { type: "fixed", amountMinor: 2500 }, // ৳ 25
        payments: [{ paymentMethod: "cash", amountMinor: 94500 }],
        expectedTotalMinor: 94500,
      });

    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.error.code).toBe("DISCOUNT_LIMIT_EXCEEDED");
    expect(rejectRes.body.error.limitBp).toBe(500);
    expect(rejectRes.body.error.attemptedBp).toBe(550);
  });
});
