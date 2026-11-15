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
import { truncateTestDatabase } from "./test-db-helper.js";

describe("M7: Fashion Analytics & Financial Reports Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let ownerToken: string;
  let cashierToken: string;
  let branchId: string;
  let shiftId: string;
  let categoryId: string;
  let brandId: string;
  let collectionId: string;
  let productId: string;
  let variantMBlueId: string;
  let variantLBlackId: string;

  async function setupTenantAndUsers() {
    const signup = await tenantsService.signup({
      companyName: "Fashion Reports Outlet Ltd",
      slug: "fashion-reports",
      businessType: "fashion",
      owner: { name: "Report Owner", email: "owner@fashionrep.com", phone: "+8801700000007", password: "Password123!" },
      branch: { name: "Gulshan Flagship", code: "GL-01" },
    });
    branchId = signup.branchId;
    const loginOwner = await authService.login({ tenantSlug: "fashion-reports", email: "owner@fashionrep.com", password: "Password123!" });
    ownerToken = loginOwner.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Floor Cashier", email: "cashier@fashionrep.com", password: "Password123!", roleIds: [cashierRole.id],
    });
    const loginCashier = await authService.login({ tenantSlug: "fashion-reports", email: "cashier@fashionrep.com", password: "Password123!" });
    cashierToken = loginCashier.accessToken;
  }

  async function setupCatalog() {
    const cat = await request(app.getHttpServer()).post("/api/v1/categories").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Denim & Jeans" });
    categoryId = cat.body.data.id;
    const br = await request(app.getHttpServer()).post("/api/v1/brands").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Artisan Denim" });
    brandId = br.body.data.id;
    const col = await request(app.getHttpServer()).post("/api/v1/collections").set("Authorization", `Bearer ${ownerToken}`).send({ name: "Autumn 2026" });
    collectionId = col.body.data.id;

    const prod = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Classic Denim Jacket", sku: "CDJ", categoryId, brandId, collectionId, priceMinor: 250000, costMinor: 100000,
      options: [{ name: "Size", values: ["M", "L"] }, { name: "Color", values: ["Blue", "Black"] }],
    });
    productId = prod.body.data.id;
    const vars = prod.body.data.variants;
    variantMBlueId = vars.find((v: any) =>
      v.optionValues.some((o: any) => o.optionValue?.value === "M") &&
      v.optionValues.some((o: any) => o.optionValue?.value === "Blue"),
    ).id;
    variantLBlackId = vars.find((v: any) =>
      v.optionValues.some((o: any) => o.optionValue?.value === "L") &&
      v.optionValues.some((o: any) => o.optionValue?.value === "Black"),
    ).id;

    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, items: [
        { variantId: variantMBlueId, quantity: 20, unitCostMinor: 100000 },
        { variantId: variantLBlackId, quantity: 15, unitCostMinor: 120000 },
      ],
    });
  }

  async function setupShiftAndSales() {
    const reg = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Pos 1", code: "POS01",
    });
    const s = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId: reg.body.data.id, branchId, openingCashMinor: 100000,
    });
    shiftId = s.body.data.id;

    await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash-movements`).set("Authorization", `Bearer ${cashierToken}`).send({
      type: "cash_in", amountMinor: 20000, reason: "Petty cash top-up",
    });
    await request(app.getHttpServer()).post(`/api/v1/shifts/${shiftId}/cash-movements`).set("Authorization", `Bearer ${cashierToken}`).send({
      type: "cash_out", amountMinor: 5000, reason: "Store supplies",
    });

    // Sale 1: 2x M-Blue @ 250,000 = 500,000; discount 50,000; total = 450,000 (300,000 cash, 150,000 bkash)
    await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send({
      shiftId, branchId, pricesIncludeTax: true,
      items: [{ variantId: variantMBlueId, quantity: 2, unitPriceMinor: 250000, discount: { type: "fixed", amountMinor: 50000 } }],
      payments: [{ paymentMethod: "cash", amountMinor: 300000 }, { paymentMethod: "bkash", amountMinor: 150000 }],
    });

    // Sale 2: 1x L-Black @ 250,000 = 250,000 (card payment)
    await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send({
      shiftId, branchId, pricesIncludeTax: true,
      items: [{ variantId: variantLBlackId, quantity: 1, unitPriceMinor: 250000 }],
      payments: [{ paymentMethod: "card", amountMinor: 250000 }],
    });

    // Sale 3: Voided sale to ensure exclusion
    const voidSaleRes = await request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${cashierToken}`).send({
      shiftId, branchId, pricesIncludeTax: true,
      items: [{ variantId: variantMBlueId, quantity: 1, unitPriceMinor: 250000 }],
      payments: [{ paymentMethod: "cash", amountMinor: 250000 }],
    });
    await request(app.getHttpServer()).post(`/api/v1/sales/${voidSaleRes.body.data.id}/void`).set("Authorization", `Bearer ${ownerToken}`).send({
      reason: "Mistake entry",
    });
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

    await setupTenantAndUsers();
    await setupCatalog();
    await setupShiftAndSales();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /reports/sales-summary computes totals and payment breakdowns excluding voided sales", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-summary?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.salesCount).toBe(2);
    expect(data.totalGrossMinor).toBe(750000);
    expect(data.totalDiscountMinor).toBe(50000);
    expect(data.totalNetMinor).toBe(700000);
    expect(data.paymentsByMethod.cash).toBe(300000);
    expect(data.paymentsByMethod.bkash).toBe(150000);
    expect(data.paymentsByMethod.card).toBe(250000);
  });

  it("GET /reports/sales-by-variant returns itemized metrics with quantity and revenue", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-by-variant?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const items = res.body.data;
    expect(items.length).toBe(2);
    const mBlue = items.find((i: any) => i.variantId === variantMBlueId);
    expect(mBlue).toBeDefined();
    expect(Number(mBlue.quantitySold)).toBe(2);
    expect(mBlue.revenueMinor).toBe(450000);
    expect(mBlue.averagePriceMinor).toBe(225000);
  });

  it("GET /reports/sales-by-category, by-brand, and by-collection aggregate accurately", async () => {
    const catRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-by-category?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(catRes.status).toBe(200);
    expect(catRes.body.data[0].categoryId).toBe(categoryId);
    expect(catRes.body.data[0].totalRevenueMinor).toBe(700000);

    const brandRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-by-brand?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(brandRes.status).toBe(200);
    expect(brandRes.body.data[0].brandId).toBe(brandId);
    expect(brandRes.body.data[0].totalRevenueMinor).toBe(700000);

    const colRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-by-collection?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(colRes.status).toBe(200);
    expect(colRes.body.data[0].collectionId).toBe(collectionId);
    expect(colRes.body.data[0].totalRevenueMinor).toBe(700000);
  });

  it("GET /reports/variant-matrix returns size x color breakdown for fashion analysis", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/variant-matrix?productId=${productId}&branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const matrix = res.body.data;
    expect(matrix.productId).toBe(productId);
    expect(matrix.options).toContain("Size");
    expect(matrix.options).toContain("Color");
    expect(matrix.cells.length).toBe(4);
    const mBlueCell = matrix.cells.find((c: any) => c.variantId === variantMBlueId);
    expect(Number(mBlueCell.qtySold)).toBe(2);
    expect(Number(mBlueCell.stockQty)).toBe(18); // 20 - 2 = 18
  });

  it("GET /reports/profit enforces report.profit permission and calculates COGS and Gross Profit", async () => {
    // 1. Cashier is forbidden (403)
    const cashierRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?branchId=${branchId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(cashierRes.status).toBe(403);

    // 2. Owner calculates:
    // Revenue = 700,000 poisha
    // COGS: 2x MBlue @ 100,000 = 200,000; 1x LBlack @ 100,000 = 100,000. Total COGS = 300,000 poisha.
    // Gross Profit = 700,000 - 300,000 = 400,000 poisha.
    // Margin = (400,000 / 700,000) * 10,000 bp = 5714 bp (57.14%).
    const ownerRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(ownerRes.status).toBe(200);
    const profit = ownerRes.body.data;
    expect(profit.revenueMinor).toBe(700000);
    expect(profit.cogsMinor).toBe(300000);
    expect(profit.grossProfitMinor).toBe(400000);
    expect(profit.profitMarginBp).toBe(5714);
  });

  it("GET /reports/stock-valuation computes total stock and valuation at weighted average cost", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/stock-valuation?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const val = res.body.data;
    // MBlue: 18 remaining @ 100,000 = 1,800,000 poisha
    // LBlack: 14 remaining @ 100,000 = 1,400,000 poisha
    // Total stock = 32; Total valuation = 3,200,000 poisha
    expect(Number(val.totalQty)).toBe(32);
    expect(val.totalValuationMinor).toBe(3200000);
    expect(val.items.length).toBe(2);
  });

  it("GET /reports/shift/:id generates comprehensive shift reconciliation", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/reports/shift/${shiftId}`)
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
    const shiftRep = res.body.data;
    expect(shiftRep.shiftId).toBe(shiftId);
    expect(shiftRep.openingCashMinor).toBe(100000);
    expect(shiftRep.cashInMinor).toBe(20000);
    expect(shiftRep.cashOutMinor).toBe(5000);
    expect(shiftRep.cashSalesMinor).toBe(300000);
    // expected cash = 100,000 + 300,000 + 20,000 - 5,000 = 415,000 poisha
    expect(shiftRep.expectedCashMinor).toBe(415000);
    expect(shiftRep.bkashSalesMinor).toBe(150000);
    expect(shiftRep.cardSalesMinor).toBe(250000);
    expect(shiftRep.totalSalesCount).toBe(2);
    expect(shiftRep.transactions.length).toBeGreaterThan(0);
  });
});
