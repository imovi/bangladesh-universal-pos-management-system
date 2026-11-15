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

describe("Fix 4: Shift Cash Sales, Non-Cash Overpayment & Closed Shift Void", () => {
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

  async function setupTenantAndUsers() {
    const signup = await tenantsService.signup({
      companyName: "Shift Accounting Outlet",
      slug: "shift-accounting",
      businessType: "fashion",
      owner: { name: "Shift Owner", email: "owner@shiftaccounting.com", phone: "+8801700000041", password: "Password123!" },
      branch: { name: "Main Counter", code: "MC-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: true,
    });

    const ownerLogin = await authService.login({ tenantSlug: "shift-accounting", email: "owner@shiftaccounting.com", password: "Password123!" });
    ownerToken = ownerLogin.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier")!;

    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Counter Cashier", email: "cashier@shiftaccounting.com", password: "Password123!", roleIds: [cashierRole.id],
    });
    const cashierLogin = await authService.login({ tenantSlug: "shift-accounting", email: "cashier@shiftaccounting.com", password: "Password123!" });
    cashierToken = cashierLogin.accessToken;
  }

  async function setupCatalogAndStock() {
    const prodRes = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Linen Shirt", sku: "LINEN", priceMinor: 100000, costMinor: 50000,
    });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId,
      items: [{ variantId, quantity: 100, unitCostMinor: 50000 }],
    });

    const regRes = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "POS Station 1", code: "POS01",
    });
    registerId = regRes.body.data.id;
  }

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

    await setupTenantAndUsers();
    await setupCatalogAndStock();
  });

  afterAll(async () => {
    await app.close();
  });

  it("(a) Rejects non-cash overpayment with 422 Unprocessable Entity", async () => {
    // Open a shift first
    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ registerId, branchId, openingCashMinor: 50000 });
    const shiftId = shiftRes.body.data.id;

    // Item total is 100,000. Customer pays 120,000 via card (non-cash overpayment).
    const s1Id = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", s1Id)
      .send({
        id: s1Id,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "card", amountMinor: 120000 }],
        expectedTotalMinor: 100000,
      });

    expect(res.status).toBe(422);

    // Close this temporary shift
    await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ closingCashMinor: 50000 });
  });

  it("(b) Correctly computes expectedCash across cash sales, change given, and cash movements", async () => {
    // Opening Cash: 50,000 poisha (500 BDT)
    const openRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ registerId, branchId, openingCashMinor: 50000 });
    const shiftId = openRes.body.data.id;

    // Sale 1: Total 100,000. Cash tendered: 120,000 -> Change: 20,000 (Net cash into drawer = 100,000)
    const sale1Id = uuidv7();
    await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", sale1Id)
      .send({
        id: sale1Id,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 120000 }],
        expectedTotalMinor: 100000,
      });

    // Sale 2: Mixed payment: Total 200,000 (2 items). 150,000 bKash + 50,000 cash.
    const sale2Id = uuidv7();
    await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", sale2Id)
      .send({
        id: sale2Id,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 2 }],
        payments: [
          { paymentMethod: "bkash", amountMinor: 150000, reference: "TRX-789" },
          { paymentMethod: "cash", amountMinor: 50000 },
        ],
        expectedTotalMinor: 200000,
      });

    // Sale 3: Pure card payment: Total 100,000 (no cash impact).
    const sale3Id = uuidv7();
    await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", sale3Id)
      .send({
        id: sale3Id,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "card", amountMinor: 100000 }],
        expectedTotalMinor: 100000,
      });

    // Sale 4: Voided sale: Total 100,000 cash. Should NOT be counted in expected cash.
    const sale4Id = uuidv7();
    const voidSaleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", sale4Id)
      .send({
        id: sale4Id,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
        expectedTotalMinor: 100000,
      });
    await request(app.getHttpServer())
      .post(`/api/v1/sales/${voidSaleRes.body.data.id}/void`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Entered by error" });

    // Cash movement: cash_in 10,000 poisha
    await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/cash-movements`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ type: "cash_in", amountMinor: 10000, reason: "Float addition" });

    // Cash movement: cash_out 5,000 poisha
    await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/cash-movements`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ type: "cash_out", amountMinor: 5000, reason: "Cleaning expense" });

    // Math calculation:
    // Opening Cash: 50,000
    // Cash Sales (tendered): 120,000 (Sale 1) + 50,000 (Sale 2) = 170,000
    // Change Given: 20,000 (Sale 1)
    // Net Cash from Sales: 170,000 - 20,000 = 150,000
    // Cash In: 10,000
    // Cash Out: 5,000
    // Expected Cash = 50,000 + 170,000 - 20,000 + 10,000 - 5,000 = 205,000 poisha

    // Test Report matches
    const repRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/shift/${shiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(repRes.status).toBe(200);
    expect(repRes.body.data.expectedCashMinor).toBe(205000);

    // Close Shift with exact counted cash = 205,000 -> discrepancy must be 0
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ closingCashMinor: 205000 });

    expect(closeRes.status).toBe(200);
    expect(Number(closeRes.body.data.expectedCashMinor)).toBe(205000);
    expect(Number(closeRes.body.data.closingCashMinor)).toBe(205000);
    expect(Number(closeRes.body.data.cashDifferenceMinor)).toBe(0);
  });

  it("(c) Reject voiding a completed sale after its shift was closed with 409 Conflict", async () => {
    // Open a new shift
    const openRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ registerId, branchId, openingCashMinor: 20000 });
    const shiftId = openRes.body.data.id;

    // Make a sale
    const sId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", sId)
      .send({
        id: sId,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
        expectedTotalMinor: 100000,
      });
    const saleId = saleRes.body.data.id;

    // Close the shift: expected cash = 20,000 + 100,000 = 120,000
    await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ closingCashMinor: 120000 });

    // Now attempt to void the sale from the closed shift
    const voidRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/void`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Trying to void sale from closed shift" });

    expect(voidRes.status).toBe(409);
  });
});
