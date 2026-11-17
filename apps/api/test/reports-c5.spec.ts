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

describe("Milestone C5: Phase 1C Reports (Returns, Damaged Stock & Profit Subtraction)", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let ownerToken: string;
  let cashierToken: string;
  let branchId: string;
  let shiftId: string;
  let productId: string;
  let variantId: string;
  let saleId: string;

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

    authService = app.get<AuthService>(AuthService);
    tenantsService = app.get<TenantsService>(TenantsService);

    // 1. Setup Tenant
    const signup = await tenantsService.signup({
      companyName: "C5 Reports Outlet Ltd",
      slug: "c5-reports",
      businessType: "fashion",
      owner: {
        name: "C5 Owner",
        email: "owner@c5reports.com",
        phone: "+8801711000005",
        password: "Password123!",
      },
      branch: { name: "Gulshan Branch", code: "GL-05" },
    });
    branchId = signup.branchId;

    const loginOwner = await authService.login({
      tenantSlug: "c5-reports",
      email: "owner@c5reports.com",
      password: "Password123!",
    });
    ownerToken = loginOwner.accessToken;

    // Cashier user
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Floor Cashier",
        email: "cashier@c5reports.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });
    const loginCashier = await authService.login({
      tenantSlug: "c5-reports",
      email: "cashier@c5reports.com",
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;

    // 2. Setup Category & Product with Cost and Price
    // Price = 2,000.00 (200000 minor), Cost = 1,000.00 (100000 minor)
    const cat = await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Menswear" });

    const prod = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Oxford Cotton Shirt",
        sku: "OX-SHT",
        categoryId: cat.body.data.id,
        priceMinor: 200000,
        costMinor: 100000,
      });
    productId = prod.body.data.id;
    variantId = prod.body.data.variants[0].id;

    // 3. Add Opening Stock of 50 units
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 50, unitCostMinor: 100000 }],
      });

    // 4. Open Shift
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId, name: "Main Counter", code: "REG01" });
    const registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ registerId, branchId, openingCashMinor: 500000 });
    shiftId = shiftRes.body.data.id;

    // 5. Create a Sale of 4 units:
    // Revenue = 4 * 200000 = 800000 minor (8,000.00 BDT)
    // COGS = 4 * 100000 = 400000 minor (4,000.00 BDT)
    const saleIdInput = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleIdInput)
      .send({
        id: saleIdInput,
        shiftId,
        branchId,
        items: [
          {
            variantId,
            quantity: 4,
          },
        ],
        expectedTotalMinor: 800000,
        payments: [{ paymentMethod: "cash", amountMinor: 800000 }],
      });
    expect(saleRes.status).toBe(201);
    saleId = saleRes.body.data.id;
    const saleItemId = saleRes.body.data.items[0].id;

    // 6. Return 2 units:
    // 1 unit "resellable" (reason: "wrong_size") -> refund 200000 minor
    // 1 unit "damaged" (reason: "defective") -> refund 200000 minor
    // Total refund = 400000 minor
    const returnIdInput = uuidv7();
    const returnRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", returnIdInput)
      .send({
        id: returnIdInput,
        shiftId,
        refundMethod: "cash",
        reason: "wrong_size",
        items: [
          {
            saleItemId,
            quantity: 1,
            condition: "resellable",
          },
          {
            saleItemId,
            quantity: 1,
            condition: "damaged",
          },
        ],
      });
    expect(returnRes.status).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("1. Returns report: returns by day, condition, reason, and product return rate", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/reports/returns")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const body = res.body.data;

    // Summary
    expect(body.summary.returnsCount).toBe(1);
    expect(body.summary.totalRefundMinor).toBe(400000);
    expect(body.summary.totalReturnedUnits).toBe(2);
    expect(body.summary.resellableUnits).toBe(1);
    expect(body.summary.damagedUnits).toBe(1);
    expect(body.summary.resellableRefundMinor).toBe(200000);
    expect(body.summary.damagedRefundMinor).toBe(200000);

    // By Day
    expect(body.byDay.length).toBeGreaterThanOrEqual(1);
    expect(body.byDay[0].returnsCount).toBe(1);
    expect(body.byDay[0].totalRefundMinor).toBe(400000);

    // By Reason: return has reason "wrong_size" for both items (2 units)
    const wrongSize = body.byReason.find((r: any) => r.reason === "wrong_size");
    expect(wrongSize).toBeDefined();
    expect(wrongSize.count).toBe(2);

    // Product Return Rate: 2 returned out of 4 sold = 50.0%
    const prodRate = body.productReturnRates.find((p: any) => p.productId === productId);
    expect(prodRate).toBeDefined();
    expect(prodRate.soldUnits).toBe(4);
    expect(prodRate.returnedUnits).toBe(2);
    expect(prodRate.returnRatePercent).toBe(50.0);

    // Items list
    expect(body.items.length).toBe(2);
    expect(body.items[0].productName).toBe("Oxford Cotton Shirt");
  });

  it("2. Damaged stock report: captures damaged returns and records financial loss at cost", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/reports/damaged-stock")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const body = res.body.data;

    // Summary
    expect(body.summary.totalDamagedUnits).toBeGreaterThanOrEqual(1);
    expect(body.summary.byMovementType.saleReturnDamagedUnits).toBe(1);
    // 1 damaged unit at cost 100000 minor = 100000 loss
    expect(body.summary.byMovementType.saleReturnDamagedLossMinor).toBe(100000);

    // Items
    const damagedItem = body.items.find((i: any) => i.movementType === "sale_return_damaged");
    expect(damagedItem).toBeDefined();
    expect(damagedItem.quantity).toBe(1);
    expect(damagedItem.unitCostMinor).toBe(100000);
    expect(damagedItem.totalLossMinor).toBe(100000);
  });

  it("3. Profit report: strictly subtracts returns from revenue and accounts for resellable vs damaged COGS", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/reports/profit")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const body = res.body.data;

    // Math verification:
    // Original revenue: 4 * 200000 = 800000
    // Returns refund: 400000
    // Net revenue: 800000 - 400000 = 400000 minor (4,000.00 BDT)
    expect(body.revenueMinor).toBe(400000);
    expect(body.returnedRevenueMinor).toBe(400000);

    // Original COGS: 4 * 100000 = 400000
    // Resellable return: 1 unit returned to stock (reverses 100000 COGS)
    // Damaged return: 1 unit lost (COGS remains recognized as expense/loss)
    // Net COGS: 400000 - 100000 = 300000 minor (3,000.00 BDT)
    expect(body.cogsMinor).toBe(300000);

    // Gross Profit = Net Revenue (400000) - Net COGS (300000) = 100000 minor (1,000.00 BDT)
    expect(body.grossProfitMinor).toBe(100000);

    // Profit Margin = (100000 / 400000) * 10000 = 2500 basis points (25.0%)
    expect(body.profitMarginBp).toBe(2500);
  });

  it("4. Permission guards: Cashier is forbidden from viewing reports", async () => {
    const resProfit = await request(app.getHttpServer())
      .get("/api/v1/reports/profit")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(resProfit.status).toBe(403);

    const resReturns = await request(app.getHttpServer())
      .get("/api/v1/reports/returns")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(resReturns.status).toBe(403);

    const resDamaged = await request(app.getHttpServer())
      .get("/api/v1/reports/damaged-stock")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(resDamaged.status).toBe(403);
  });
});
