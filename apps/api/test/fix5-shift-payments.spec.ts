import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { SALE_PAYMENT_METHODS, type SalePaymentMethod } from "@universal-pos/shared";

describe("Fix 5: Per-payment-method figures in shift close and shift report", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;
  let cashierToken: string;
  let branchId: string;
  let registerId: string;
  let variantId: string;

  beforeAll(async () => {
    await truncateTestDatabase();
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    systemDb = app.get(SystemDbService);

    // Setup tenant
    const signup = await tenantsService.signup({
      companyName: "Payment Method Test Store",
      slug: "payment-method-store",
      businessType: "fashion",
      owner: {
        name: "Store Owner",
        email: "owner@pmstore.com",
        phone: "+8801700000055",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: true,
    });

    const ownerLogin = await authService.login({
      tenantSlug: "payment-method-store",
      email: "owner@pmstore.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier")!;

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Test Cashier",
        email: "cashier@pmstore.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });
    const cashierLogin = await authService.login({
      tenantSlug: "payment-method-store",
      email: "cashier@pmstore.com",
      password: "Password123!",
    });
    cashierToken = cashierLogin.accessToken;

    // Create product
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Standard Polo Shirt",
        sku: "POLO-01",
        priceMinor: 1000,
        costMinor: 500,
      });
    variantId = prodRes.body.data.variants[0].id;

    // Initial stock
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, unitCostMinor: 500 }],
      });

    // Register
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        name: "Checkout 1",
        code: "REG-01",
      });
    registerId = regRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("calculates exact totals per payment method and includes them in close response and shift report", async () => {
    // Open a shift
    const openRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 10000,
      });
    expect(openRes.status).toBe(201);
    const shiftId = openRes.body.data.id;

    // Expected payment amounts for each method in SALE_PAYMENT_METHODS:
    // cash: 1,000 (qty 1)
    // card: 2,000 (qty 2)
    // bkash: 3,000 (qty 3)
    // nagad: 4,000 (qty 4)
    // rocket: 5,000 (qty 5)
    // bank_transfer: 6,000 (qty 6)
    const testAmounts: Record<SalePaymentMethod, number> = {
      cash: 1000,
      card: 2000,
      bkash: 3000,
      nagad: 4000,
      rocket: 5000,
      bank_transfer: 6000,
      points: 7000,
    };

    let totalExpectedSalesMinor = 0;

    let qty = 1;
    for (const method of SALE_PAYMENT_METHODS) {
      const amountMinor = testAmounts[method];
      totalExpectedSalesMinor += amountMinor;
      const saleId = uuidv7();

      const saleRes = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send({
          id: saleId,
          shiftId,
          branchId,
          items: [
            {
              variantId,
              quantity: qty,
            },
          ],
          payments: [
            {
              paymentMethod: method,
              amountMinor,
              reference: `REF-${method.toUpperCase()}`,
            },
          ],
          expectedTotalMinor: amountMinor,
        });

      expect(saleRes.status).toBe(201);
      qty++;
    }

    // Check Shift Report
    const reportRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/shift/${shiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(reportRes.status).toBe(200);
    const reportData = reportRes.body.data;

    expect(reportData.paymentMethodTotalsMinor).toBeDefined();

    for (const method of SALE_PAYMENT_METHODS) {
      expect(reportData.paymentMethodTotalsMinor[method]).toBe(testAmounts[method]);
    }

    const reportSum = (Object.values(reportData.paymentMethodTotalsMinor) as number[]).reduce(
      (a, b) => a + b,
      0,
    );
    expect(reportSum).toBe(totalExpectedSalesMinor);

    // Verify deprecated fields still work correctly
    expect(reportData.cardSalesMinor).toBe(testAmounts.card);
    expect(reportData.bkashSalesMinor).toBe(
      testAmounts.bkash + testAmounts.nagad + testAmounts.rocket,
    );

    // Close Shift:
    // Opening Cash = 10,000
    // Cash Sales = 1,000
    // Expected Cash = 11,000
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        closingCashMinor: 11000,
      });

    expect(closeRes.status).toBe(200);
    const closeData = closeRes.body.data;

    expect(Number(closeData.expectedCashMinor)).toBe(11000);
    expect(Number(closeData.cashDifferenceMinor)).toBe(0);
    expect(closeData.paymentMethodTotalsMinor).toBeDefined();

    for (const method of SALE_PAYMENT_METHODS) {
      expect(closeData.paymentMethodTotalsMinor[method]).toBe(testAmounts[method]);
    }

    const closeSum = (Object.values(closeData.paymentMethodTotalsMinor) as number[]).reduce(
      (a, b) => a + b,
      0,
    );
    expect(closeSum).toBe(totalExpectedSalesMinor);
  });
});
