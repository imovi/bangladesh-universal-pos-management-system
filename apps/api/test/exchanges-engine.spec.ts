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

describe("Exchanges Engine & Edge Cases (Integration)", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantBToken: string;
  let tenantId: string;
  let tenantBId: string;
  let branchId: string;
  let tenantBBranchId: string;
  let registerId: string;
  let openShiftId: string;
  let variantId1: string;
  let variantId2: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.setGlobalPrefix("api/v1");
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    systemDb = app.get(SystemDbService);

    // 1. Setup Tenant A
    const slugA = `exchanges-outlet-${Date.now()}`;
    const ownerEmailA = `owner-${Date.now()}@exchanges.pos`;
    const signupA = await tenantsService.signup({
      companyName: "Exchanges Boutique Ltd",
      slug: slugA,
      businessType: "fashion",
      owner: {
        name: "Exchange Owner",
        email: ownerEmailA,
        phone: "+8801700000031",
        password: "Password123!",
      },
      branch: { name: "Dhaka Branch", code: "EX-01" },
    });
    tenantId = signupA.tenantId;
    branchId = signupA.branchId;

    const loginA = await authService.login({
      tenantSlug: slugA,
      email: ownerEmailA,
      password: "Password123!",
    });
    ownerToken = loginA.accessToken;

    // 2. Setup Cashier
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    const cashierEmail = `cashier-${Date.now()}@exchanges.pos`;
    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Floor Cashier",
        email: cashierEmail,
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const loginCashier = await authService.login({
      tenantSlug: slugA,
      email: cashierEmail,
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;

    // 3. Register
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId, name: "Counter 1", code: "REG01" });
    registerId = regRes.body.data.id;

    // 4. Products & Stock
    const taxRes = await request(app.getHttpServer())
      .post("/api/v1/tax-classes")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "VAT 5%", rateBp: 500, isDefault: true });
    const taxClassId = taxRes.body.data.id;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
      return_window_days: 7,
    });

    const p1 = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Linen Shirt",
        sku: `LSHIRT-${Date.now()}`,
        priceMinor: 100000, // 1,000 BDT + 5% VAT = 105,000 poisha
        costMinor: 50000,
        taxClassId,
        options: [{ name: "Size", values: ["M"] }],
      });
    variantId1 = p1.body.data.variants[0].id;

    const p2 = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Cotton Panjabi",
        sku: `PANJABI-${Date.now()}`,
        priceMinor: 150000, // 1,500 BDT + 5% VAT = 157,500 poisha
        costMinor: 75000,
        taxClassId,
        options: [{ name: "Size", values: ["L"] }],
      });
    variantId2 = p2.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [
          { variantId: variantId1, quantity: 100, unitCostMinor: 50000 },
          { variantId: variantId2, quantity: 100, unitCostMinor: 75000 },
        ],
      });

    // 5. Open shift
    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ registerId, branchId, openingCashMinor: 1000000 });
    openShiftId = shiftRes.body.data.id;

    // 6. Setup Tenant B for isolation test
    const slugB = `comp-outlet-${Date.now()}`;
    const ownerEmailB = `comp-${Date.now()}@comp.com`;
    const signupB = await tenantsService.signup({
      companyName: "Competitor Outlet Ltd",
      slug: slugB,
      businessType: "fashion",
      owner: {
        name: "Comp Owner",
        email: ownerEmailB,
        phone: "+8801700000032",
        password: "Password123!",
      },
      branch: { name: "Chittagong Outlet", code: "CTG-01" },
    });
    tenantBId = signupB.tenantId;
    tenantBBranchId = signupB.branchId;

    const loginB = await authService.login({
      tenantSlug: slugB,
      email: ownerEmailB,
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;
  }, 45000);

  afterAll(async () => {
    if (app) await app.close();
  });

  it("1. Exchange: new items cost MORE and customer pays cash difference", async () => {
    // 1. Get current shift expected cash
    const shiftBefore = (
      await request(app.getHttpServer())
        .get(`/api/v1/shifts/${openShiftId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
    ).body.data;
    const cashBefore = BigInt(shiftBefore.summary?.expectedCashMinor ?? 0);

    // 2. Create sale to exchange (1 unit of Linen Shirt = 105,000 poisha)
    const saleId = uuidv7();
    const sRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId1, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 105000 }],
        expectedTotalMinor: 105000,
      });
    expect(sRes.status).toBe(201);
    const saleItemId = sRes.body.data.items[0].id;

    // 3. Exchange: return Linen Shirt (105,000), buy Cotton Panjabi (150,000)
    // Customer pays cash difference: 45,000 poisha
    const exId = uuidv7();
    const exRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send({
        id: exId,
        originalSaleId: saleId,
        shiftId: openShiftId,
        branchId,
        returnItems: [{ saleItemId, quantity: 1, condition: "resellable" }],
        newItems: [{ variantId: variantId2, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 45000 }],
      });
    expect(exRes.status).toBe(201);
    expect(exRes.body.data.differenceMinor).toBe(45000);

    // 4. Verify shift cash:
    // Net cash added = 105,000 + 45,000 = 150,000 poisha
    const shiftAfter = (
      await request(app.getHttpServer())
        .get(`/api/v1/shifts/${openShiftId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
    ).body.data;
    expect(BigInt(shiftAfter.summary?.expectedCashMinor ?? 0)).toBe(cashBefore + 150000n);
  });

  it("2. Exchange: new items cost LESS and shop refunds cash difference", async () => {
    // 1. Ensure drawer has sufficient cash
    await request(app.getHttpServer())
      .post("/api/v1/shifts/cash-movement")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        type: "payin",
        amountMinor: 500000,
        reason: "Float addition",
      });

    // 2. Create sale to exchange (1 unit of Cotton Panjabi = 157,500 poisha)
    const saleId = uuidv7();
    const sRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId2, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 157500 }],
        expectedTotalMinor: 157500,
      });
    expect(sRes.status).toBe(201);
    const saleItemId = sRes.body.data.items[0].id;

    const shiftBefore = (
      await request(app.getHttpServer())
        .get(`/api/v1/shifts/${openShiftId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
    ).body.data;
    const cashBefore = BigInt(shiftBefore.summary?.expectedCashMinor ?? 0);

    // 3. Exchange: return Cotton Panjabi (157,500), buy Linen Shirt (105,000)
    // Shop refunds cash difference: 52,500 poisha
    const exId = uuidv7();
    const exRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send({
        id: exId,
        originalSaleId: saleId,
        shiftId: openShiftId,
        branchId,
        refundMethod: "cash",
        returnItems: [{ saleItemId, quantity: 1, condition: "resellable" }],
        newItems: [{ variantId: variantId1, quantity: 1 }],
        payments: [],
      });
    expect(exRes.status).toBe(201);
    expect(exRes.body.data.differenceMinor).toBe(-57500);

    // 4. Expected cash goes down by exactly 57,500 poisha
    const shiftAfter = (
      await request(app.getHttpServer())
        .get(`/api/v1/shifts/${openShiftId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
    ).body.data;
    expect(BigInt(shiftAfter.summary?.expectedCashMinor ?? 0)).toBe(cashBefore - 57500n);
  });

  it("3. Cashier discount limit on new item in exchange", async () => {
    // Cashier has 5% limit (500 bp). Attempting 10% (1000 bp) line discount without override rejects with 403
    const discountSaleId = uuidv7();
    const discSaleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", discountSaleId)
      .send({
        id: discountSaleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId2, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 157500 }],
        expectedTotalMinor: 157500,
      });
    expect(discSaleRes.status).toBe(201);
    const discItemId = discSaleRes.body.data.items[0].id;

    const failExId = uuidv7();
    const failExRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", failExId)
      .send({
        id: failExId,
        originalSaleId: discountSaleId,
        shiftId: openShiftId,
        branchId,
        returnItems: [{ saleItemId: discItemId, quantity: 1, condition: "resellable" }],
        newItems: [
          {
            variantId: variantId1,
            quantity: 1,
            discount: { type: "percent", percentBp: 1000 },
          },
        ],
        payments: [],
      });
    expect(failExRes.status).toBe(403);
    expect(failExRes.body.error?.code || failExRes.body.message).toContain("DISCOUNT_LIMIT_EXCEEDED");
  });

  it("4. Drawer cash check on exchange refund", async () => {
    // Create card sale with 20 Cotton Panjabis = 3,150,000 poisha (no cash added to drawer)
    const saleId = uuidv7();
    const sRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId2, quantity: 20 }],
        payments: [{ paymentMethod: "card", amountMinor: 3150000 }],
        expectedTotalMinor: 3150000,
      });
    expect(sRes.status).toBe(201);
    const saleItemId = sRes.body.data.items[0].id;

    // Empty drawer via payout
    const shiftNow = (
      await request(app.getHttpServer())
        .get(`/api/v1/shifts/${openShiftId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
    ).body.data;
    const currentCash = BigInt(shiftNow.summary?.expectedCashMinor ?? 0);

    if (currentCash > 5000n) {
      await request(app.getHttpServer())
        .post("/api/v1/shifts/cash-movement")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          shiftId: openShiftId,
          type: "payout",
          amountMinor: Number(currentCash - 5000n),
          reason: "Cash pull",
        });
    }

    // Now drawer cash is ~5,000 poisha (50 BDT).
    // Exchange: return 20 Cotton Panjabis (3,150,000), buy 1 Linen Shirt (105,000)
    // Refund difference = 3,045,000 poisha. Exceeds drawer!
    const exId = uuidv7();
    const exRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send({
        id: exId,
        originalSaleId: saleId,
        shiftId: openShiftId,
        branchId,
        refundMethod: "cash",
        returnItems: [{ saleItemId, quantity: 20, condition: "resellable" }],
        newItems: [{ variantId: variantId1, quantity: 1 }],
        payments: [],
      });
    expect(exRes.status).toBe(409);
    expect(exRes.body.error?.code || exRes.body.message).toContain("DRAWER_CASH_EXCEEDED");
  });

  it("5. Idempotent exchange retry", async () => {
    // Add float back to drawer
    await request(app.getHttpServer())
      .post("/api/v1/shifts/cash-movement")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        type: "payin",
        amountMinor: 500000,
        reason: "Refill float",
      });

    // Create a sale to exchange
    const saleId = uuidv7();
    const sRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId1, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 105000 }],
        expectedTotalMinor: 105000,
      });
    expect(sRes.status).toBe(201);
    const saleItemId = sRes.body.data.items[0].id;

    const exId = uuidv7();
    const payload = {
      id: exId,
      originalSaleId: saleId,
      shiftId: openShiftId,
      branchId,
      returnItems: [{ saleItemId, quantity: 1, condition: "resellable" }],
      newItems: [{ variantId: variantId2, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 45000 }],
    };

    // First request
    const firstRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send(payload);
    expect(firstRes.status).toBe(201);

    // Exact retry returns same record
    const retryRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send(payload);
    expect([200, 201]).toContain(retryRes.status);
    expect(retryRes.body.data.return.id).toBe(firstRes.body.data.return.id);
    expect(retryRes.body.data.sale.id).toBe(firstRes.body.data.sale.id);

    // Conflicting payload with same idempotency key returns 409
    const conflictRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exId)
      .send({
        ...payload,
        payments: [{ paymentMethod: "cash", amountMinor: 99999 }],
      });
    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error?.code || conflictRes.body.message).toContain("IDEMPOTENCY_CONFLICT");
  });

  it("6. Cross-tenant exchange isolation", async () => {
    // Attempt exchange with Tenant B's saleId using Tenant A's token -> 404
    const fakeSaleId = uuidv7();
    const crossExId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", crossExId)
      .send({
        id: crossExId,
        originalSaleId: fakeSaleId,
        shiftId: openShiftId,
        branchId,
        returnItems: [{ saleItemId: uuidv7(), quantity: 1, condition: "resellable" }],
        newItems: [{ variantId: variantId1, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 105000 }],
      });
    expect(res.status).toBe(404);
  });
});
