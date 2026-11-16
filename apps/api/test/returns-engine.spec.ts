import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase, getTestAdminDatabaseUrl } from "./test-db-helper.js";

describe("Milestone C1: Returns and Exchanges Engine Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let systemDb: SystemDbService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let openShiftId: string;
  let variantId1: string;
  let variantId2: string;
  let originalSaleId: string;
  let saleItemId1: string;
  let saleItemId2: string;

  // Tenant B for isolation test
  let tenantBToken: string;
  let tenantBId: string;

  beforeAll(async () => {
    await truncateTestDatabase();

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
    tenantContext = app.get(TenantContextService);
    systemDb = app.get(SystemDbService);

    // Setup Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Returns Test Outlet Ltd",
      slug: "returns-outlet",
      businessType: "fashion",
      owner: {
        name: "Returns Owner",
        email: "owner@returns.com",
        phone: "+8801700000021",
        password: "Password123!",
      },
      branch: { name: "Dhaka Flagship", code: "DF-01" },
    });
    tenantId = signupA.tenantId;
    branchId = signupA.branchId;

    const loginA = await authService.login({
      tenantSlug: "returns-outlet",
      email: "owner@returns.com",
      password: "Password123!",
    });
    ownerToken = loginA.accessToken;

    // Create Cashier user
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Floor Cashier",
        email: "cashier@returns.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });
    const loginCashier = await authService.login({
      tenantSlug: "returns-outlet",
      email: "cashier@returns.com",
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;

    // Create register
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId, name: "Main Counter", code: "REG01" });
    registerId = regRes.body.data.id;

    // Setup catalog: tax class, products, opening stock
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
        sku: "LSHIRT",
        priceMinor: 100000, // 1,000 BDT
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
        sku: "PANJABI",
        priceMinor: 150000, // 1,500 BDT
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
          { variantId: variantId1, quantity: 50, unitCostMinor: 50000 },
          { variantId: variantId2, quantity: 50, unitCostMinor: 75000 },
        ],
      });

    // Setup Tenant B for tenant isolation testing
    const signupB = await tenantsService.signup({
      companyName: "Competitor Outlet Ltd",
      slug: "comp-outlet",
      businessType: "fashion",
      owner: {
        name: "Comp Owner",
        email: "owner@comp.com",
        phone: "+8801700000022",
        password: "Password123!",
      },
      branch: { name: "Chittagong Outlet", code: "CTG-01" },
    });
    tenantBId = signupB.tenantId;
    const loginB = await authService.login({
      tenantSlug: "comp-outlet",
      email: "owner@comp.com",
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("1. Opens a shift with 10,000 BDT cash (1,000,000 poisha)", async () => {
    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ registerId, branchId, openingCashMinor: 1000000 });
    expect(shiftRes.status).toBe(201);
    openShiftId = shiftRes.body.data.id;
    expect(shiftRes.body.data.status).toBe("open");
  });

  it("2. Creates an original sale with 2 units of Linen Shirt and 1 Cotton Panjabi", async () => {
    originalSaleId = uuidv7();
    // Subtotal: 2 * 1,000 + 1 * 1,500 = 3,500 BDT (350,000 poisha)
    // 5% Tax: 350,000 * 500 / 10000 = 17,500 poisha
    // Total: 367,500 poisha
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", originalSaleId)
      .send({
        id: originalSaleId,
        shiftId: openShiftId,
        branchId,
        items: [
          { variantId: variantId1, quantity: 2 },
          { variantId: variantId2, quantity: 1 },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 367500 }],
        expectedTotalMinor: 367500,
      });

    expect(saleRes.status).toBe(201);
    expect(saleRes.body.data.status).toBe("completed");
    expect(saleRes.body.data.totalMinor).toBe(367500);

    const items = saleRes.body.data.items;
    const item1 = items.find((i: any) => i.variantId === variantId1);
    const item2 = items.find((i: any) => i.variantId === variantId2);
    saleItemId1 = item1.id;
    saleItemId2 = item2.id;
  });

  let returnId1: string;

  it("3. Returns 1 unit of Linen Shirt (resellable) with exact poisha refund", async () => {
    returnId1 = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${originalSaleId}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", returnId1)
      .send({
        id: returnId1,
        shiftId: openShiftId,
        refundMethod: "cash",
        reason: "Customer size change",
        items: [{ saleItemId: saleItemId1, quantity: 1, condition: "resellable" }],
      });

    expect(retRes.status).toBe(201);
    const ret = retRes.body.data;
    expect(ret.returnNumber).toMatch(/REG.*-R-\d{6}-\d{4}/);
    expect(ret.refundMethod).toBe("cash");
    // Line 1 total was: 2 * 100,000 + 10,000 tax = 210,000. Returning 1 unit = exactly 105,000 poisha
    expect(ret.totalRefundMinor).toBe(105000);
    expect(ret.taxRefundMinor).toBe(5000);
    expect(ret.items).toHaveLength(1);
    expect(ret.items[0].condition).toBe("resellable");

    // Verify stock restored for resellable return (was 50 - 2 = 48, now 49)
    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId1}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(stockRes.body.data[0].qty)).toBe(49);
  });

  it("4. Rejects over-return if returning 2 more units of Linen Shirt (only 1 remaining)", async () => {
    const overReturnId = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${originalSaleId}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", overReturnId)
      .send({
        id: overReturnId,
        shiftId: openShiftId,
        refundMethod: "cash",
        items: [{ saleItemId: saleItemId1, quantity: 2, condition: "resellable" }],
      });

    expect(retRes.status).toBe(409);
    expect(retRes.body.error?.code || retRes.body.message).toContain("OVER_RETURN_PROHIBITED");
  });

  it("5. Returns damaged Cotton Panjabi without restocking", async () => {
    const returnId2 = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${originalSaleId}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", returnId2)
      .send({
        id: returnId2,
        shiftId: openShiftId,
        refundMethod: "cash",
        reason: "Torn stitching",
        items: [{ saleItemId: saleItemId2, quantity: 1, condition: "damaged" }],
      });

    expect(retRes.status).toBe(201);
    expect(retRes.body.data.items[0].condition).toBe("damaged");

    // Verify stock is NOT restored for damaged item (was 50 - 1 = 49, stays 49)
    const stockRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId2}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(stockRes.body.data[0].qty)).toBe(49);

    // Verify inventory movement recorded with type 'sale_return_damaged'
    const moveRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/movements?variantId=${variantId2}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const movements = moveRes.body.data.items || moveRes.body.data;
    const damagedMove = movements.find(
      (m: any) => m.type === "sale_return_damaged" && m.refId === returnId2,
    );
    expect(damagedMove).toBeDefined();
    expect(damagedMove.qtyDelta).toBe(0);
  });

  it("6. Prevents voiding a sale that has return records", async () => {
    const voidRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${originalSaleId}/void`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Accidental sale" });

    expect(voidRes.status).toBe(400);
    const errText = voidRes.body.error?.message || voidRes.body.message || "";
    expect(errText).toContain("Cannot void a sale that has returns");
  });

  it("7. Cash refund exceeding drawer cash is rejected with 409 DRAWER_CASH_EXCEEDED", async () => {
    // Create a large sale with card payment (drawer cash doesn't increase)
    const cardSaleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", cardSaleId)
      .send({
        id: cardSaleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId2, quantity: 10 }], // 10 * 1,500 * 1.05 = 15,750 BDT = 1,575,000 poisha
        payments: [{ paymentMethod: "card", amountMinor: 1575000 }],
        expectedTotalMinor: 1575000,
      });
    expect(saleRes.status).toBe(201);
    const cardSaleItemId = saleRes.body.data.items[0].id;

    // Withdraw all cash from drawer to trigger insufficient cash
    // Currently drawer has: 1,000,000 opening + 367,500 cash sale - 105,000 refund - 157,500 refund = 1,105,000 poisha
    await request(app.getHttpServer())
      .post("/api/v1/shifts/cash-movement")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        type: "payout",
        amountMinor: 1100000,
        reason: "Midday bank drop",
      });

    // Now drawer cash is ~5,000 poisha. Attempting a cash refund of 1,575,000 poisha will exceed drawer
    const retId = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${cardSaleId}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", retId)
      .send({
        id: retId,
        shiftId: openShiftId,
        refundMethod: "cash",
        items: [{ saleItemId: cardSaleItemId, quantity: 10, condition: "resellable" }],
      });

    expect(retRes.status).toBe(409);
    expect(retRes.body.error?.code || retRes.body.message).toContain("DRAWER_CASH_EXCEEDED");
  });

  it("8. Processes exchange (return + new sale in one transaction)", async () => {
    // Create a sale to exchange
    const saleToExchangeId = uuidv7();
    const sRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleToExchangeId)
      .send({
        id: saleToExchangeId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId1, quantity: 1 }], // 1,000 * 1.05 = 105,000 poisha
        payments: [{ paymentMethod: "cash", amountMinor: 105000 }],
        expectedTotalMinor: 105000,
      });
    expect(sRes.status).toBe(201);
    const saleToExchItemId = sRes.body.data.items[0].id;

    // Exchange: Return Linen Shirt (105,000 poisha), Buy Cotton Panjabi (157,500 poisha)
    // Customer pays difference: 157,500 - 105,000 = 52,500 poisha
    const exchangeId = uuidv7();
    const exRes = await request(app.getHttpServer())
      .post("/api/v1/sales/exchange")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", exchangeId)
      .send({
        id: exchangeId,
        originalSaleId: saleToExchangeId,
        shiftId: openShiftId,
        branchId,
        returnItems: [{ saleItemId: saleToExchItemId, quantity: 1, condition: "resellable" }],
        newItems: [{ variantId: variantId2, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 52500 }],
      });

    expect(exRes.status).toBe(201);
    const ex = exRes.body.data;
    expect(ex.totalRefundMinor).toBe(105000);
    expect(ex.exchangeSaleId).toBeDefined();
    expect(ex.exchangeSale.totalMinor).toBe(157500);
    expect(ex.exchangeSale.status).toBe("completed");
  });

  it("9. Return window enforcement and override permission check", async () => {
    // Create a sale and manually set its createdAt to 30 days ago via admin connection
    const oldSaleId = uuidv7();
    await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", oldSaleId)
      .send({
        id: oldSaleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: variantId1, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 105000 }],
        expectedTotalMinor: 105000,
      });

    const adminPrisma = new PrismaClient({
      datasources: { db: { url: getTestAdminDatabaseUrl() } },
    });
    await adminPrisma.$executeRaw`
      UPDATE sales SET created_at = NOW() - INTERVAL '30 days' WHERE id = ${oldSaleId}::uuid;
    `;
    await adminPrisma.$disconnect();

    const oldSaleItem = (
      await request(app.getHttpServer())
        .get(`/api/v1/sales/${oldSaleId}`)
        .set("Authorization", `Bearer ${cashierToken}`)
    ).body.data.items[0];

    // Cashier (without sale.return.override) attempts return -> 403 RETURN_WINDOW_EXCEEDED
    const failId = uuidv7();
    const failRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${oldSaleId}/returns`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", failId)
      .send({
        id: failId,
        shiftId: openShiftId,
        refundMethod: "cash",
        items: [{ saleItemId: oldSaleItem.id, quantity: 1, condition: "resellable" }],
      });
    expect(failRes.status).toBe(403);
    expect(failRes.body.error?.code || failRes.body.message).toContain("RETURN_WINDOW_EXCEEDED");

    // Owner (has override) attempts without reason -> 422 OVERRIDE_REASON_REQUIRED
    const noReasonId = uuidv7();
    const noReasonRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${oldSaleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", noReasonId)
      .send({
        id: noReasonId,
        shiftId: openShiftId,
        refundMethod: "cash",
        items: [{ saleItemId: oldSaleItem.id, quantity: 1, condition: "resellable" }],
      });
    expect(noReasonRes.status).toBe(422);

    // Owner with override reason succeeds
    const okId = uuidv7();
    const okRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${oldSaleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", okId)
      .send({
        id: okId,
        shiftId: openShiftId,
        refundMethod: "cash",
        overrideReason: "VIP customer approval",
        items: [{ saleItemId: oldSaleItem.id, quantity: 1, condition: "resellable" }],
      });
    expect(okRes.status).toBe(201);
    expect(okRes.body.data.overrideReason).toBe("VIP customer approval");
  });

  it("10. Tenant isolation: Tenant B cannot access Tenant A returns", async () => {
    // GET /sales/returns/:id
    const bGetRes = await request(app.getHttpServer())
      .get(`/api/v1/sales/returns/${returnId1}`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(bGetRes.status).toBe(404);

    // Tenant B's list should not include Tenant A's return
    const bListRes = await request(app.getHttpServer())
      .get("/api/v1/sales/returns")
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(bListRes.status).toBe(200);
    expect(bListRes.body.data.items).toHaveLength(0);
  });

  it("11. Shift details and reports correctly deduct returns", async () => {
    // Shift details
    const shiftRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${openShiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(shiftRes.status).toBe(200);
    expect(shiftRes.body.data.returns).toBeDefined();
    expect(shiftRes.body.data.returns.length).toBeGreaterThan(0);

    // Reports summary
    const reportRes = await request(app.getHttpServer())
      .get("/api/v1/reports/sales-summary")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.returnsCount).toBeGreaterThan(0);
    expect(reportRes.body.data.totalRefundMinor).toBeGreaterThan(0);
  });
});
