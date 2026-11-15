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
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("M6: Sales Engine Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let openShiftId: string;
  let closedShiftId: string;
  let variantId: string;
  let customerId: string;
  let createdSaleId: string;

  async function setupAuthAndTenant() {
    const signup = await tenantsService.signup({
      companyName: "Sales Engine Outlet Ltd",
      slug: "sales-outlet",
      businessType: "fashion",
      owner: { name: "Sales Owner", email: "owner@salesoutlet.com", phone: "+8801700000004", password: "Password123!" },
      branch: { name: "Main Outlet", code: "MO-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    const loginOwner = await authService.login({ tenantSlug: "sales-outlet", email: "owner@salesoutlet.com", password: "Password123!" });
    ownerToken = loginOwner.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "POS Cashier", email: "cashier@salesoutlet.com", password: "Password123!", roleIds: [cashierRole.id],
    });
    const loginCashier = await authService.login({ tenantSlug: "sales-outlet", email: "cashier@salesoutlet.com", password: "Password123!" });
    cashierToken = loginCashier.accessToken;
  }

  async function setupCatalogAndStock() {
    const taxRes = await request(app.getHttpServer()).post("/api/v1/tax-classes").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Standard 5% VAT", rateBp: 500, isDefault: true,
    });
    const taxClassId = taxRes.body.data.id;

    await app.get(SystemDbService).updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
    });

    const prodRes = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Silk Scarf", sku: "SCARF", priceMinor: 100000, costMinor: 40000, taxClassId, options: [{ name: "Color", values: ["Red"] }],
    });
    variantId = prodRes.body.data.variants[0].id;

    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, items: [{ variantId, quantity: 50, unitCostMinor: 40000 }],
    });

    const custRes = await request(app.getHttpServer()).post("/api/v1/customers").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Anisur Rahman", phone: "01755554444",
    });
    customerId = custRes.body.data.id;
  }

  async function setupShifts() {
    const regRes = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Register 1", code: "REG01",
    });
    const s1 = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId: regRes.body.data.id, branchId, openingCashMinor: 50000,
    });
    openShiftId = s1.body.data.id;

    const reg2Res = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Register 2", code: "REG02",
    });
    const s2 = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId: reg22Id(reg2Res), branchId, openingCashMinor: 10000,
    });
    closedShiftId = s2.body.data.id;
    await request(app.getHttpServer()).post(`/api/v1/shifts/${closedShiftId}/close`).set("Authorization", `Bearer ${cashierToken}`).send({ closingCashMinor: 10000 });
  }

  function reg22Id(res: any) { return res.body.data.id; }

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
    tenantContext = app.get(TenantContextService);

    await setupAuthAndTenant();
    await setupCatalogAndStock();
    await setupShifts();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /sales creates sale, updates stock, customer metrics, and formats invoice number", async () => {
    const salePayload = {
      shiftId: openShiftId, branchId, customerId,
      items: [{ variantId, quantity: 2, discount: { type: "percent", percentBp: 1000 } }],
      payments: [{ paymentMethod: "cash", amountMinor: 100000 }, { paymentMethod: "bkash", amountMinor: 89000, reference: "TRX-123456" }],
      expectedTotalMinor: 189000,
    };
    const res = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${ownerToken}`).send(salePayload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("completed");
    expect(Number(res.body.data.totalMinor)).toBe(189000);
    expect(Number(res.body.data.taxMinor)).toBe(9000);
    expect(Number(res.body.data.discountMinor)).toBe(20000);
    expect(res.body.data.invoiceNumber).toMatch(/^REG01-\d{6}-\d{4}$/);
    createdSaleId = res.body.data.id;

    const stockRes = await request(app.getHttpServer()).get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(stockRes.body.data[0].qty)).toBe(48);

    const custRes = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(custRes.body.data.totalSpentMinor)).toBe(189000);
    expect(custRes.body.data.totalVisits).toBe(1);
  });

  it("Idempotent sale creation: supplying same client id returns existing sale without double stock deduction", async () => {
    const clientId = uuidv7();
    const payload = {
      id: clientId, shiftId: openShiftId, branchId,
      items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 105000 }], expectedTotalMinor: 105000,
    };
    const res1 = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send(payload);
    expect(res1.status).toBe(201);
    expect(res1.body.data.id).toBe(clientId);

    const res2 = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.data.id).toBe(clientId);

    const stockRes = await request(app.getHttpServer()).get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(stockRes.body.data[0].qty)).toBe(47);
  });

  it("POST /sales rejects calculation mismatch with 422 Unprocessable Entity", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send({
      shiftId: openShiftId, branchId, items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 105000 }], expectedTotalMinor: 999999,
    });
    expect(res.status).toBe(422);
  });

  it("POST /sales rejects sale on a closed shift", async () => {
    const res = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send({
      shiftId: closedShiftId, branchId, items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 105000 }], expectedTotalMinor: 105000,
    });
    expect(res.status).toBe(400);
  });

  it("POST /sales/:id/void voids sale, restores stock, and reverses customer metrics", async () => {
    const cashierVoidRes = await request(app.getHttpServer()).post(`/api/v1/sales/${createdSaleId}/void`).set("Authorization", `Bearer ${cashierToken}`).send({ reason: "Customer changed mind" });
    expect(cashierVoidRes.status).toBe(403);

    const voidRes = await request(app.getHttpServer()).post(`/api/v1/sales/${createdSaleId}/void`).set("Authorization", `Bearer ${ownerToken}`).send({ reason: "Customer changed mind" });
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.data.status).toBe("voided");

    const stockRes = await request(app.getHttpServer()).get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(stockRes.body.data[0].qty)).toBe(49);

    const custRes = await request(app.getHttpServer()).get(`/api/v1/customers/${customerId}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(custRes.body.data.totalSpentMinor)).toBe(0);

    const reVoidRes = await request(app.getHttpServer()).post(`/api/v1/sales/${createdSaleId}/void`).set("Authorization", `Bearer ${ownerToken}`).send({ reason: "Another reason" });
    expect(reVoidRes.status).toBe(400);
  });

  it("sales are immutable from deletion and unauthorized updates", async () => {
    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`DELETE FROM sales WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table sales/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`UPDATE sales SET total_minor = 1 WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table sales/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`UPDATE sale_items SET unit_price_minor = 1 WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table sale_items/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`DELETE FROM sale_payments WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table sale_payments/);
  });

  it("GET /sales and GET /sales/:id retrieves sale details and list", async () => {
    const listRes = await request(app.getHttpServer()).get(`/api/v1/sales?branchId=${branchId}`).set("Authorization", `Bearer ${cashierToken}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items.length).toBeGreaterThan(0);

    const getRes = await request(app.getHttpServer()).get(`/api/v1/sales/${createdSaleId}`).set("Authorization", `Bearer ${cashierToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe(createdSaleId);
  });
});
