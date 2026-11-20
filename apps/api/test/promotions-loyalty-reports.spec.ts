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
import { truncateTestDatabase } from "./test-db-helper.js";

describe("Milestone E5: Promotions, Loyalty & Profit Reports API Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let token: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let customerId: string;
  let variantId: string;
  let promoId: string;
  let saleId: string;
  let returnId: string;

  beforeAll(async () => {
    await truncateTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);

    // 1. Setup tenant & branch
    const signupRes = await request(app.getHttpServer())
      .post("/api/v1/tenants/signup")
      .send({
        companyName: "Reports E5 Fashion Ltd",
        slug: "reports-e5",
        businessType: "fashion",
        owner: {
          name: "E5 Owner",
          email: "owner@reportse5.com",
          phone: "+8801755555555",
          password: "Password123!",
        },
        branch: { name: "Dhanmondi Branch", code: "DH-01" },
      });
    expect(signupRes.status).toBe(201);
    branchId = signupRes.body.data.branchId;

    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({
        tenantSlug: "reports-e5",
        email: "owner@reportse5.com",
        password: "Password123!",
      });
    expect(loginRes.status).toBe(200);
    token = loginRes.body.data.accessToken;

    // 2. Setup register & open shift
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId, name: "Reg 1", code: "R01" });
    registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${token}`)
      .send({ branchId, registerId, openingCashMinor: 50000 });
    shiftId = shiftRes.body.data.id;

    // 3. Setup category & product
    // Price: ৳1,000 (100,000 minor), Cost: ৳400 (40,000 minor)
    const catRes = await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Cotton Shirts" });
    const categoryId = catRes.body.data.id;

    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Premium Cotton Shirt",
        sku: "PCS",
        categoryId,
        priceMinor: 100000,
        costMinor: 40000,
        options: [{ name: "Size", values: ["M"] }],
      });
    variantId = prodRes.body.data.variants[0].id;

    // Opening stock: 100 units @ ৳400
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${token}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 100, unitCostMinor: 40000 }],
      });

    // 4. Setup customer
    const custRes = await request(app.getHttpServer())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Reports Customer", phone: "+8801711223344" });
    customerId = custRes.body.data.id;

    // 5. Setup loyalty settings: 1 pt per ৳100 (10000 minor), value ৳1.00 (100 minor)
    await request(app.getHttpServer())
      .patch("/api/v1/settings/loyalty")
      .set("Authorization", `Bearer ${token}`)
      .send({
        isEnabled: true,
        earnRateMinor: 10000,
        pointValueMinor: 100,
        minRedeemPoints: 0,
        maxBillSharePercent: 50,
      });

    // 6. Setup 20% Discount Promotion
    const promoRes = await request(app.getHttpServer())
      .post("/api/v1/promotions")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Eid 20% Off",
        description: "20% off all cotton shirts",
        type: "PERCENT_OFF",
        status: "active",
        priority: 50,
        config: { percentBp: 2000 },
        targets: { targetType: "ALL" },
      });
    expect(promoRes.status).toBe(201);
    promoId = promoRes.body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Creates promoted sale and partial return, then verifies Profit Report exact to poisha", async () => {
    // Sale: 4 units @ ৳1,000 = ৳4,000 gross (400,000 minor)
    // 20% discount = ৳800 (80,000 minor)
    // Net Revenue = ৳3,200 (320,000 minor)
    // COGS = 4 units @ ৳400 = ৳1,600 (160,000 minor)
    // Points earned = floor(3200 / 100) = 32 points
    saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        branchId,
        shiftId,
        customerId,
        items: [{ variantId, quantity: 4 }],
        payments: [{ paymentMethod: "cash", amountMinor: 320000 }],
        expectedTotalMinor: 320000,
      });
    expect(saleRes.status).toBe(201);
    const saleData = saleRes.body.data;
    const saleItemId = saleData.items[0].id;

    // Partial Return: 1 unit returned (resellable)
    // Unit effective price after discount = ৳1,000 - 20% = ৳800 (80,000 minor)
    // Refund = ৳800 (80,000 minor)
    // Returned COGS = 1 unit @ ৳400 = ৳400 (40,000 minor)
    returnId = uuidv7();
    const returnRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/returns`)
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", returnId)
      .send({
        id: returnId,
        shiftId,
        originalSaleId: saleId,
        branchId,
        refundMethod: "cash",
        items: [{ saleItemId, quantity: 1, condition: "resellable", reason: "Wrong size" }],
      });
    expect(returnRes.status).toBe(201);

    // Expected Profit Report after 4 sold and 1 returned:
    // Net units sold = 4 - 1 = 3 units
    // Net Revenue = ৳3,200 - ৳800 = ৳2,400 (240,000 minor)
    // Net COGS = ৳1,600 - ৳400 = ৳1,200 (120,000 minor)
    // Gross Profit = ৳2,400 - ৳1,200 = ৳1,200 (120,000 minor)
    // Profit Margin = (120,000 / 240,000) * 10,000 bp = 5000 bp (50.00%)
    const profitRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/profit?branchId=${branchId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(profitRes.status).toBe(200);

    const profit = profitRes.body.data;
    expect(profit.revenueMinor).toBe(240000);
    expect(profit.cogsMinor).toBe(120000);
    expect(profit.grossProfitMinor).toBe(120000);
    expect(profit.profitMarginBp).toBe(5000);
  });

  it("2. Verifies GET /reports/promotions returns exact promotional sales, units, gross, discount, and returns", async () => {
    const promoRepRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/promotions?branchId=${branchId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(promoRepRes.status).toBe(200);

    const rep = promoRepRes.body.data;
    expect(rep.summary.totalSalesCount).toBe(1);
    expect(rep.summary.totalUnitsSold).toBe(4);
    expect(rep.summary.totalGrossMinor).toBe(400000);
    expect(rep.summary.totalDiscountGivenMinor).toBe(80000);
    expect(rep.summary.totalNetMinor).toBe(320000);
    expect(rep.summary.totalReturnUnits).toBe(1);
    expect(rep.summary.totalReturnRefundMinor).toBe(80000);
    expect(rep.summary.netAfterReturnsMinor).toBe(240000);

    const promoItem = rep.items.find((i: any) => i.promotionId === promoId);
    expect(promoItem).toBeDefined();
    expect(promoItem.name).toBe("Eid 20% Off");
    expect(promoItem.salesCount).toBe(1);
    expect(promoItem.unitsSold).toBe(4);
    expect(promoItem.grossMinor).toBe(400000);
    expect(promoItem.discountGivenMinor).toBe(80000);
    expect(promoItem.netMinor).toBe(320000);
    expect(promoItem.returnUnits).toBe(1);
    expect(promoItem.returnRefundMinor).toBe(80000);
    expect(promoItem.netAfterReturnsMinor).toBe(240000);

    expect(rep.daily.length).toBeGreaterThan(0);
    expect(rep.daily[0].unitsSold).toBe(4);
    expect(rep.daily[0].discountGivenMinor).toBe(80000);
  });

  it("3. Verifies GET /reports/loyalty returns monthly figures, outstanding balance, liability, and top customers", async () => {
    // In test 1:
    // Sale 1 earned 32 points.
    // Return 1 reversed 25% of points (1/4 of 32 = 8 points).
    // Remaining balance = 24 points.
    const loyaltyRepRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/loyalty?branchId=${branchId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(loyaltyRepRes.status).toBe(200);

    const rep = loyaltyRepRes.body.data;
    expect(rep.summary.totalPointsIssued).toBe(32);
    expect(rep.summary.totalPointsReversed).toBe(8);
    expect(rep.summary.totalOutstandingPoints).toBe(24);
    // Liability: 24 points * ৳1.00 (100 minor) = ৳24 (2400 minor)
    expect(rep.summary.liabilityMinor).toBe(2400);
    expect(rep.summary.pointValueMinor).toBe(100);

    // Monthly breakdown
    expect(rep.monthly.length).toBeGreaterThan(0);
    expect(rep.monthly[0].issued).toBe(32);
    expect(rep.monthly[0].reversed).toBe(8);
    expect(rep.monthly[0].netChange).toBe(24);

    // Top customers
    expect(rep.topCustomers.length).toBeGreaterThan(0);
    const topCust = rep.topCustomers[0];
    expect(topCust.id).toBe(customerId);
    expect(topCust.name).toBe("Reports Customer");
    expect(topCust.pointsBalance).toBe(24);
    expect(topCust.liabilityMinor).toBe(2400);
  });

  it("4. Verifies GET /reports/sales-summary includes totalPromotionDiscountMinor and totalPointsPaidMinor", async () => {
    const summaryRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/sales-summary?branchId=${branchId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(summaryRes.status).toBe(200);

    const summary = summaryRes.body.data;
    expect(summary.totalPromotionDiscountMinor).toBe(80000);
    expect(summary.totalPointsPaidMinor).toBe(0);
  });
});
