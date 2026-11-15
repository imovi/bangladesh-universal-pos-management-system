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

describe("Fix 3 — Mandatory Sale ID and Canonical Hash Idempotency", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;

  let ownerToken: string;
  let tenantId: string;
  let branchId: string;
  let shiftId: string;
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

    const signup = await tenantsService.signup({
      companyName: "Mandatory Sale ID Outlet",
      slug: "sale-id-outlet",
      businessType: "fashion",
      owner: {
        name: "Fix3 Owner",
        email: "owner@saleid.com",
        phone: "+8801700000033",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "M03" },
    });

    tenantId = signup.tenantId;
    branchId = signup.branchId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: true,
    });

    const ownerLogin = await authService.login({
      tenantSlug: "sale-id-outlet",
      email: "owner@saleid.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    // Create Register & Shift
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        name: "POS Counter 1",
        code: "REG1",
      });
    expect(regRes.status).toBe(201);
    const registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 100000,
      });
    expect(shiftRes.status).toBe(201);
    shiftId = shiftRes.body.data.id;

    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Fix3 Polo",
        sku: `POLO-${Date.now()}`,
        priceMinor: 100000, // 1000.00 BDT
        costMinor: 60000,
      });
    expect(prodRes.status).toBe(201);
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, unitCostMinor: 60000 }],
      });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("rejects POST /sales when body id is missing with 400", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        // id is omitted
        shiftId,
        branchId,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects POST /sales when Idempotency-Key header is missing with 400", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      // No Idempotency-Key header
      .send({
        id: saleId,
        shiftId,
        branchId,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("rejects POST /sales when Idempotency-Key header differs from body id with 400", async () => {
    const saleId = uuidv7();
    const otherKey = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", otherKey)
      .send({
        id: saleId,
        shiftId,
        branchId,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_MISMATCH");
  });

  it("returns 200 with existing sale on repeat request with identical payload", async () => {
    const saleId = uuidv7();
    const payload = {
      id: saleId,
      shiftId,
      branchId,
      expectedTotalMinor: 100000,
      items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
    };

    const firstRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload);

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.data.id).toBe(saleId);

    // Repeat identical request
    const secondRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload);

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.id).toBe(saleId);
    expect(secondRes.body.data.invoiceNumber).toBe(firstRes.body.data.invoiceNumber);
  });

  it("returns 409 Conflict when repeating same sale id with different payment split (same total)", async () => {
    const saleId = uuidv7();
    const payload1 = {
      id: saleId,
      shiftId,
      branchId,
      expectedTotalMinor: 100000,
      items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
    };

    const firstRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload1);

    expect(firstRes.status).toBe(201);

    // Repeat with different payment split (500 BDT cash + 500 BDT card)
    const payload2 = {
      id: saleId,
      shiftId,
      branchId,
      expectedTotalMinor: 100000,
      items: [{ variantId, quantity: 1 }],
      payments: [
        { paymentMethod: "cash", amountMinor: 50000 },
        { paymentMethod: "card", amountMinor: 50000, reference: "TXN123" },
      ],
    };

    const conflictRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload2);

    expect(conflictRes.status).toBe(409);
    expect(conflictRes.body.error.message).toContain(`Sale ${saleId} already exists with different payload`);
  });
});
