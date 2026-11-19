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
import { v7 as uuidv7 } from "uuid";

describe("Shift figures and shift close use occurred_at for offline sales", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;
  let branchId: string;
  let registerId: string;
  let variantId: string;

  beforeAll(async () => {
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

    const tenantSlug = `shift-${Date.now()}`;
    const ownerEmail = `owner-${Date.now()}@occurred.com`;
    const signup = await tenantsService.signup({
      companyName: "OccurredAt Shift Shop",
      slug: tenantSlug,
      businessType: "fashion",
      owner: {
        name: "Shift Owner",
        email: ownerEmail,
        phone: "+8801700999888",
        password: "Password123!",
      },
      branch: { name: "Dhaka Branch", code: "DHK-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: true,
    });

    const loginRes = await authService.login({
      tenantSlug,
      email: ownerEmail,
      password: "Password123!",
    });
    ownerToken = loginRes.accessToken;

    // Register
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId, name: "Reg 1", code: "REG01", allowOffline: true });
    registerId = regRes.body.data.id;

    // Product & Stock
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Cotton Polo", sku: "POLO", priceMinor: 50000, costMinor: 25000 });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, costPriceMinor: 25000 }],
      });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("calculates shift summary and closes shift including offline sales by occurred_at", async () => {
    // 1. Open shift
    const shiftOpenRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 100000, // ৳1,000 opening cash
      });
    expect(shiftOpenRes.status).toBe(201);
    const shiftId = shiftOpenRes.body.data.id;
    const openedAt = new Date(shiftOpenRes.body.data.openedAt);

    // 2. Create offline sale occurring 10 minutes after openedAt
    const offlineOccurredAt = new Date(openedAt.getTime() + 10 * 60 * 1000);
    const today = offlineOccurredAt.toISOString().slice(2, 10).replace(/-/g, "");
    const offlineInvoiceNumber = `REG01-O-${today}-0001`;

    const saleId = uuidv7();
    const offlineSaleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        invoiceNumber: offlineInvoiceNumber,
        isOffline: true,
        occurredAt: offlineOccurredAt.toISOString(),
        expectedTotalMinor: 100000,
        items: [
          {
            variantId,
            quantity: 2, // 2 * 50000 = 100000
            unitPriceMinor: 50000,
            taxRateBp: 0,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 100000, // ৳1,000 cash payment
          },
        ],
      });
    if (offlineSaleRes.status !== 201) {
      console.log("OFFLINE SALE ERROR:", JSON.stringify(offlineSaleRes.body));
    }
    expect(offlineSaleRes.status).toBe(201);
    expect(offlineSaleRes.body.data.occurredAt).toBe(offlineOccurredAt.toISOString());

    // 3. GET /api/v1/shifts/:id must reflect the offline sale in expectedCash and cash figures
    const getShiftRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${shiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(getShiftRes.status).toBe(200);

    const shiftData = getShiftRes.body.data;
    // Expected cash: 100000 opening + 100000 cash sale = 200000
    expect(shiftData.summary.expectedCashMinor).toBe(200000);
    expect(shiftData.summary.cashPaymentsMinor).toBe(100000);
    expect(shiftData.summary.netCashSalesMinor).toBe(100000);

    // 4. GET /api/v1/reports/shift/:id must display transaction at occurredAt
    const reportRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/shift/${shiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.data.expectedCashMinor).toBe(200000);
    const saleTx = reportRes.body.data.transactions.find((tx: any) => tx.inv === offlineInvoiceNumber);
    expect(saleTx).toBeDefined();
    expect(saleTx.at).toBe(offlineOccurredAt.toISOString());

    // 5. POST /api/v1/shifts/:id/close with expected cash (200000)
    const closeRes = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        closingCashMinor: 200000,
        notes: "Shift closed with offline sales counted by occurred_at",
      });
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe("closed");
    expect(Number(closeRes.body.data.expectedCashMinor)).toBe(200000);
    expect(Number(closeRes.body.data.closingCashMinor)).toBe(200000);
    expect(Number(closeRes.body.data.cashDifferenceMinor)).toBe(0);
    expect(closeRes.body.data.paymentMethodTotalsMinor.cash).toBe(100000);
  });
});
