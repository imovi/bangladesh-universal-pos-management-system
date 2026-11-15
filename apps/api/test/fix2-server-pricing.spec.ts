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
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("Fix 2: Server Decides Price & Overrides Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let branchId: string;
  let openShiftId: string;
  let activeVariantId: string;
  let inactiveVariantId: string;

  async function setupTenantAndUsers() {
    const signup = await tenantsService.signup({
      companyName: "Server Pricing Outlet",
      slug: "server-pricing",
      businessType: "fashion",
      owner: { name: "Price Owner", email: "owner@serverprice.com", phone: "+8801700000021", password: "Password123!" },
      branch: { name: "Central Branch", code: "CB-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    // Set prices_include_tax to false so we can verify exact tax addition
    await systemDb.updateTenantSettings(signup.tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
    });

    const ownerLogin = await authService.login({ tenantSlug: "server-pricing", email: "owner@serverprice.com", password: "Password123!" });
    ownerToken = ownerLogin.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const roles = rolesRes.body.data;
    const managerRole = roles.find((r: any) => r.name === "Manager")!;
    const cashierRole = roles.find((r: any) => r.name === "Cashier")!;

    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Store Manager", email: "manager@serverprice.com", password: "Password123!", roleIds: [managerRole.id],
    });
    const managerLogin = await authService.login({ tenantSlug: "server-pricing", email: "manager@serverprice.com", password: "Password123!" });
    managerToken = managerLogin.accessToken;

    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "POS Cashier", email: "cashier@serverprice.com", password: "Password123!", roleIds: [cashierRole.id],
    });
    const cashierLogin = await authService.login({ tenantSlug: "server-pricing", email: "cashier@serverprice.com", password: "Password123!" });
    cashierToken = cashierLogin.accessToken;
  }

  async function setupCatalogAndStock() {
    // Create tax class: 7.5% (750 bp)
    const taxRes = await request(app.getHttpServer()).post("/api/v1/tax-classes").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Standard Apparel VAT", rateBp: 750, isDefault: true,
    });
    const taxClassId = taxRes.body.data.id;

    // Create Active Product (Price 200,000 poisha = 2,000 BDT)
    const prodRes = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Polo Shirt", sku: "POLO", priceMinor: 200000, costMinor: 80000, taxClassId,
      options: [{ name: "Size", values: ["M", "L"] }],
    });
    activeVariantId = prodRes.body.data.variants[0].id;
    inactiveVariantId = prodRes.body.data.variants[1].id;

    // Set variant[1] to inactive directly in database via tenant context
    const tenantContext = app.get(TenantContextService);
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      await tx.productVariant.update({
        where: { id: inactiveVariantId },
        data: { isActive: false },
      });
    });

    // Opening stock
    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId,
      items: [{ variantId: activeVariantId, quantity: 50, unitCostMinor: 80000 }],
    });
  }

  async function setupShift() {
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

    await setupTenantAndUsers();
    await setupCatalogAndStock();
    await setupShift();
  });

  afterAll(async () => {
    await app.close();
  });

  it("(a) Cashier without sale.price_override cannot override unit price (403 Forbidden)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: activeVariantId, quantity: 1, overrideUnitPriceMinor: 150000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 161250 }],
        expectedTotalMinor: 161250,
      });

    expect(res.status).toBe(403);
  });

  it("(b) Request with no override uses database price even if expectedTotalMinor differs (422 Unprocessable Entity)", async () => {
    // Catalogue price is 200,000 + 7.5% VAT (15,000) = 215,000 poisha.
    // Client sends expectedTotalMinor: 100,000 (trying to sell cheap without override).
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: activeVariantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 215000 }],
        expectedTotalMinor: 100000, // Mismatch with server price!
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("CALCULATION_MISMATCH");
    expect(res.body.error.details[0].serverTotalMinor).toBe(215000);
    expect(res.body.error.details[0].breakdown).toBeDefined();
  });

  it("(c) Inactive variant is rejected with 422 Unprocessable Entity", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: inactiveVariantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 215000 }],
        expectedTotalMinor: 215000,
      });

    expect(res.status).toBe(422);
  });

  it("(c2) Inactive parent product is rejected with 422 Unprocessable Entity", async () => {
    // Create an inactive product
    const inactProdRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Inactive Jacket",
        sku: "INACT-JKT",
        priceMinor: 500000,
        costMinor: 250000,
      });
    const inactVarId = inactProdRes.body.data.variants[0].id;
    const inactProdId = inactProdRes.body.data.id;

    // Deactivate the product
    await request(app.getHttpServer())
      .patch(`/api/v1/products/${inactProdId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ isActive: false });

    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: inactVarId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 500000 }],
        expectedTotalMinor: 500000,
      });

    expect(res.status).toBe(422);
  });

  it("(d) Tax rate automatically comes from the product tax class (7.5% = 750 bp)", async () => {
    // 1 item @ 200,000 catalogue price + 7.5% tax (15,000) = 215,000 poisha
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: activeVariantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 215000 }],
        expectedTotalMinor: 215000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.taxMinor).toBe(15000);
    expect(res.body.data.totalMinor).toBe(215000);
    expect(res.body.data.items[0].taxRateBp).toBe(750);
  });

  it("(e) Manager with sale.price_override is accepted and both original and override prices are stored", async () => {
    // Override price: 180,000 poisha + 7.5% tax (13,500) = 193,500 poisha
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [{ variantId: activeVariantId, quantity: 1, overrideUnitPriceMinor: 180000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 193500 }],
        expectedTotalMinor: 193500,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalMinor).toBe(193500);
    const item = res.body.data.items[0];
    expect(Number(item.originalUnitPriceMinor)).toBe(200000);
    expect(Number(item.unitPriceMinor)).toBe(180000);
  });

  it("(f) Basket with multiple line items of same variant: originalUnitPriceMinor is only recorded on overridden line", async () => {
    // Line 1: Normal catalogue price 200,000 + 7.5% tax (15,000) = 215,000 poisha
    // Line 2: Overridden price 150,000 + 7.5% tax (11,250) = 161,250 poisha
    // Total: 376,250 poisha
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        shiftId: openShiftId,
        branchId,
        items: [
          { variantId: activeVariantId, quantity: 1 },
          { variantId: activeVariantId, quantity: 1, overrideUnitPriceMinor: 150000 },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 376250 }],
        expectedTotalMinor: 376250,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.totalMinor).toBe(376250);
    const [line1, line2] = res.body.data.items;
    expect(line1.originalUnitPriceMinor).toBeNull();
    expect(Number(line1.unitPriceMinor)).toBe(200000);
    expect(Number(line2.originalUnitPriceMinor)).toBe(200000);
    expect(Number(line2.unitPriceMinor)).toBe(150000);
  });
});
