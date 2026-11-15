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
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("Fix 3: Enforce Discount Limits Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantContext: TenantContextService;
  let tenantId: string;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let branchId: string;
  let openShiftId: string;
  let variantId: string;

  async function setupTenantAndUsers() {
    const signup = await tenantsService.signup({
      companyName: "Discount Limit Outlet",
      slug: "discount-limit",
      businessType: "fashion",
      owner: { name: "Discount Owner", email: "owner@discountoutlet.com", phone: "+8801700000031", password: "Password123!" },
      branch: { name: "Central Branch", code: "CB-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    // Use prices_include_tax = false for clear math: 100,000 item + 0% tax
    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
    });

    const ownerLogin = await authService.login({ tenantSlug: "discount-limit", email: "owner@discountoutlet.com", password: "Password123!" });
    ownerToken = ownerLogin.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const roles = rolesRes.body.data;
    const managerRole = roles.find((r: any) => r.name === "Manager")!;
    const cashierRole = roles.find((r: any) => r.name === "Cashier")!;

    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Store Manager", email: "manager@discountoutlet.com", password: "Password123!", roleIds: [managerRole.id],
    });
    const managerLogin = await authService.login({ tenantSlug: "discount-limit", email: "manager@discountoutlet.com", password: "Password123!" });
    managerToken = managerLogin.accessToken;

    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "POS Cashier", email: "cashier@discountoutlet.com", password: "Password123!", roleIds: [cashierRole.id],
    });
    const cashierLogin = await authService.login({ tenantSlug: "discount-limit", email: "cashier@discountoutlet.com", password: "Password123!" });
    cashierToken = cashierLogin.accessToken;
  }

  async function setupCatalogAndStock() {
    const prodRes = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Summer T-Shirt", sku: "TSHIRT", priceMinor: 100000, costMinor: 40000,
    });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId,
      items: [{ variantId, quantity: 100, unitCostMinor: 40000 }],
    });

    const regRes = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Counter 1", code: "CTR01",
    });
    const shiftRes = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId: regRes.body.data.id, branchId, openingCashMinor: 100000,
    });
    openShiftId = shiftRes.body.data.id;
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
    tenantContext = app.get(TenantContextService);

    await setupTenantAndUsers();
    await setupCatalogAndStock();
  });

  afterAll(async () => {
    await app.close();
  });

  it("(a) Cashier cannot give 6% discount (exceeds role limit of 5% -> 403 Forbidden)", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, discount: { type: "percent", percentBp: 600 } }],
        payments: [{ paymentMethod: "cash", amountMinor: 94000 }],
        expectedTotalMinor: 94000,
      });

    expect(res.status).toBe(403);
  });

  it("(b) Cashier can give 5% discount (at role limit of 5% -> 201 Created)", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, discount: { type: "percent", percentBp: 500 } }],
        payments: [{ paymentMethod: "cash", amountMinor: 95000 }],
        expectedTotalMinor: 95000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.discountMinor).toBe(5000);
    expect(res.body.data.totalMinor).toBe(95000);
  });

  it("(c) Manager can give 15% discount (within role limit of 20% -> 201 Created)", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, discount: { type: "percent", percentBp: 1500 } }],
        payments: [{ paymentMethod: "cash", amountMinor: 85000 }],
        expectedTotalMinor: 85000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.discountMinor).toBe(15000);
    expect(res.body.data.totalMinor).toBe(85000);
  });

  it("(d) Manager with sale.discount_override can approve 25% discount (exceeds role limit of 20% -> 201 Created)", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, discount: { type: "percent", percentBp: 2500 } }],
        payments: [{ paymentMethod: "cash", amountMinor: 75000 }],
        expectedTotalMinor: 75000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.discountMinor).toBe(25000);
    expect(res.body.data.totalMinor).toBe(75000);
  });

  it("(e) Fixed discount larger than item price is rejected with 422 Unprocessable Entity", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, discount: { type: "fixed", amountMinor: 150000 } }], // item price 100,000
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
        expectedTotalMinor: 0,
      });

    expect(res.status).toBe(422);
  });

  it("(f) Audit log contains override record when discount override is used", async () => {
    const auditRes = await request(app.getHttpServer())
      .get("/api/v1/audit-logs?action=sale.override")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(auditRes.status).toBe(200);
    expect(auditRes.body.data.length).toBeGreaterThanOrEqual(1);
    const log = auditRes.body.data[0];
    expect(log.action).toBe("sale.override");
    expect(log.entityType).toBe("sale");
    expect(log.after.discountOverrideUsed).toBe(true);
  });

  it("(g) Audit log contains override record when price override is used", async () => {
    const saleId = uuidv7();
    await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: openShiftId,
        branchId,
        items: [{ variantId, quantity: 1, overrideUnitPriceMinor: 90000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 90000 }],
        expectedTotalMinor: 90000,
      });

    const auditRes = await request(app.getHttpServer())
      .get("/api/v1/audit-logs?action=sale.override")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(auditRes.status).toBe(200);
    const priceOverrideLog = auditRes.body.data.find(
      (l: any) => l.after?.priceOverrideUsed === true,
    );
    expect(priceOverrideLog).toBeDefined();
  });
});
