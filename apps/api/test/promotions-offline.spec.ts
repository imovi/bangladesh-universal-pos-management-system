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
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { v7 as uuidv7 } from "uuid";

describe("Phase 1E Mid-Run Fix: Offline PROMOTION_CHANGED Sales Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let ownerToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let variant2200Id: string;
  let variant6000Id: string;

  let test1SaleId: string;
  let promo20Id: string;

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
    tenantContext = app.get(TenantContextService);

    // 1. Setup Tenant
    const signup = await tenantsService.signup({
      companyName: "Offline Promo Test Store",
      slug: "offline-promo-store",
      businessType: "fashion",
      owner: {
        name: "Store Owner",
        email: "owner@offlinepromo.com",
        phone: "+8801700000099",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    const loginRes = await authService.login({
      tenantSlug: "offline-promo-store",
      email: "owner@offlinepromo.com",
      password: "Password123!",
    });
    ownerToken = loginRes.accessToken;

    // 2. Setup Register & Shift
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId, name: "Offline Register 1", code: "REG01" });
    registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ registerId, branchId, openingCashMinor: 50000 });
    shiftId = shiftRes.body.data.id;

    // 3. Products
    // Product 1: ৳2,200 variant
    const p1Res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Panjabi Special",
        sku: "PAN-2200",
        priceMinor: 220000,
        costMinor: 110000,
      });
    variant2200Id = p1Res.body.data.variants[0].id;

    // Product 2: ৳6,000 variant
    const p2Res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Premium Sherwani",
        sku: "SHER-6000",
        priceMinor: 600000,
        costMinor: 300000,
      });
    variant6000Id = p2Res.body.data.variants[0].id;

    // Initial Stock
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [
          { variantId: variant2200Id, quantity: 50, unitCostMinor: 110000 },
          { variantId: variant6000Id, quantity: 50, unitCostMinor: 300000 },
        ],
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Ended promotion: accepts offline sale with PROMOTION_CHANGED flag and increments discount total", async () => {
    // Create 20% promotion on ৳2,200 Panjabi
    const promoRes = await request(app.getHttpServer())
      .post("/api/v1/promotions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "20% off Panjabi",
        type: "PERCENT_OFF",
        status: "active",
        priority: 10,
        stackableWithBill: true,
        config: { percentBp: 2000 },
        targets: { targetType: "VARIANTS", targetIds: [variant2200Id] },
      });
    expect(promoRes.status).toBe(201);
    promo20Id = promoRes.body.data.id;

    // End promotion before sync
    const endRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promo20Id}/end`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(endRes.status).toBe(200);

    // Build offline sale: 2 units at ৳2,200 (gross ৳4,400), 20% off = ৳880 discount, total = ৳3,520 (352000 minor)
    test1SaleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", test1SaleId)
      .send({
        id: test1SaleId,
        shiftId,
        branchId,
        isOffline: true,
        invoiceNumber: "REG01-O-261120-0001",
        occurredAt: new Date().toISOString(),
        items: [
          {
            variantId: variant2200Id,
            quantity: 2,
            unitPriceMinor: 220000,
            promotionId: promo20Id,
            promotionDiscountMinor: 88000,
            promotionLabel: "20% off Panjabi",
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 352000,
          },
        ],
        expectedTotalMinor: 352000,
      });

    expect(saleRes.status).toBe(201);
    const saleData = saleRes.body.data;
    expect(Number(saleData.totalMinor)).toBe(352000);
    expect(saleData.items[0].promotionId).toBe(promo20Id);
    expect(Number(saleData.items[0].promotionDiscountMinor)).toBe(88000);

    // Verify review flag PROMOTION_CHANGED is present
    const reviewRes = await request(app.getHttpServer())
      .get(`/api/v1/sales/offline-review`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(reviewRes.status).toBe(200);
    const promoFlag = reviewRes.body.data.data.find(
      (f: any) => f.saleId === test1SaleId && f.flag === "PROMOTION_CHANGED"
    );
    expect(promoFlag).toBeDefined();
    expect(promoFlag.details.clientTotalMinor).toBe(352000);

    // Verify promotion's discount total went up by ৳880
    const promoCheckRes = await request(app.getHttpServer())
      .get(`/api/v1/promotions/${promo20Id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(promoCheckRes.status).toBe(200);
    expect(Number(promoCheckRes.body.data.totalDiscountMinor)).toBe(88000);
    expect(promoCheckRes.body.data.totalUses).toBe(1);
  });

  it("2. Edited promotion: stores client's 20% discount and records server's 10% total in flag", async () => {
    // Create new promotion at 20%
    const pRes = await request(app.getHttpServer())
      .post("/api/v1/promotions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Promo To Edit",
        type: "PERCENT_OFF",
        status: "active",
        priority: 15,
        stackableWithBill: true,
        config: { percentBp: 2000 },
        targets: { targetType: "VARIANTS", targetIds: [variant2200Id] },
      });
    const editPromoId = pRes.body.data.id;

    // Edit to 10%
    await request(app.getHttpServer())
      .patch(`/api/v1/promotions/${editPromoId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        config: { percentBp: 1000 },
      });

    // Post offline sale where client had applied 20% (352000 minor)
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        isOffline: true,
        invoiceNumber: "REG01-O-261120-0002",
        occurredAt: new Date().toISOString(),
        items: [
          {
            variantId: variant2200Id,
            quantity: 2,
            unitPriceMinor: 220000,
            promotionId: editPromoId,
            promotionDiscountMinor: 88000,
            promotionLabel: "Promo To Edit",
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 352000,
          },
        ],
        expectedTotalMinor: 352000,
      });

    expect(saleRes.status).toBe(201);
    expect(Number(saleRes.body.data.totalMinor)).toBe(352000);
    expect(Number(saleRes.body.data.items[0].promotionDiscountMinor)).toBe(88000);

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/v1/sales/offline-review`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const promoFlag = reviewRes.body.data.data.find(
      (f: any) => f.saleId === saleId && f.flag === "PROMOTION_CHANGED"
    );
    expect(promoFlag).toBeDefined();
    expect(promoFlag.details.clientTotalMinor).toBe(352000);
    // With 10%, 4400 - 440 = 396000
    expect(promoFlag.details.serverTotalMinor).toBe(396000);
  });

  it("3. Lost bill threshold: accepts offline sale with paused bill promotion and stores bill promo discount", async () => {
    // Create bill threshold promotion: 10% over ৳5,000, cap ৳1,000
    const bRes = await request(app.getHttpServer())
      .post("/api/v1/promotions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "10% over 5000",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 20,
        stackableWithBill: true,
        config: {
          thresholdMinor: 500000,
          discountType: "PERCENT",
          percentBp: 1000,
          maxDiscountMinor: 100000,
        },
        targets: { targetType: "ALL" },
      });
    const billPromoId = bRes.body.data.id;

    // Pause the promotion before sync
    await request(app.getHttpServer())
      .post(`/api/v1/promotions/${billPromoId}/pause`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Offline sale: 1 unit of ৳6,000 Sherwani (600000), bill discount 10% = ৳600 (60000), total = ৳5,400 (540000)
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        isOffline: true,
        invoiceNumber: "REG01-O-261120-0003",
        occurredAt: new Date().toISOString(),
        billPromotionId: billPromoId,
        billPromotionDiscountMinor: 60000,
        items: [
          {
            variantId: variant6000Id,
            quantity: 1,
            unitPriceMinor: 600000,
          },
        ],
        payments: [
          {
            paymentMethod: "cash",
            amountMinor: 540000,
          },
        ],
        expectedTotalMinor: 540000,
      });

    expect(saleRes.status).toBe(201);
    expect(Number(saleRes.body.data.totalMinor)).toBe(540000);
    expect(saleRes.body.data.billPromotionId).toBe(billPromoId);
    expect(Number(saleRes.body.data.billPromotionDiscountMinor)).toBe(60000);

    const reviewRes = await request(app.getHttpServer())
      .get(`/api/v1/sales/offline-review`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const promoFlag = reviewRes.body.data.data.find(
      (f: any) => f.saleId === saleId && f.flag === "PROMOTION_CHANGED"
    );
    expect(promoFlag).toBeDefined();
  });

  it("4. Tampered payload: returns 400 when line promotionDiscountMinor > line gross", async () => {
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        isOffline: true,
        invoiceNumber: "REG01-O-261120-0004",
        occurredAt: new Date().toISOString(),
        items: [
          {
            variantId: variant2200Id,
            quantity: 1,
            unitPriceMinor: 220000,
            promotionId: promo20Id,
            // Gross is 220,000, but promo discount claims 300,000!
            promotionDiscountMinor: 300000,
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 0 }],
        expectedTotalMinor: 0,
      });

    expect(saleRes.status).toBe(400);
  });

  it("5. Inconsistent payload: returns 422 TOTALS_MISMATCH when client values do not add up", async () => {
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        isOffline: true,
        invoiceNumber: "REG01-O-261120-0005",
        occurredAt: new Date().toISOString(),
        items: [
          {
            variantId: variant2200Id,
            quantity: 2,
            unitPriceMinor: 220000,
            promotionId: promo20Id,
            promotionDiscountMinor: 88000,
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 300000 }],
        // Correct rebuilt total is 352,000, but client claims 300,000
        expectedTotalMinor: 300000,
      });

    expect(saleRes.status).toBe(422);
    expect(saleRes.body.error?.code || saleRes.body.code).toBe("TOTALS_MISMATCH");
  });

  it("6. Online stays strict: non-offline sale with changed promotion is rejected", async () => {
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        isOffline: false,
        items: [
          {
            variantId: variant2200Id,
            quantity: 2,
            unitPriceMinor: 220000,
            promotionId: promo20Id, // Ended promo
            promotionDiscountMinor: 88000,
          },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: 352000 }],
        expectedTotalMinor: 352000,
      });

    expect(saleRes.status).toBe(422);
    expect(saleRes.body.error?.code || saleRes.body.code).toBe("CALCULATION_MISMATCH");
  });

  it("7. Return on a flagged sale: refunds stored line net amount (৳1,760 for 1 unit)", async () => {
    // Return 1 unit from test 1 sale (test1SaleId had 2 units for ৳3,520, so 1 unit is ৳1,760 = 176000 minor)
    const saleRes = await request(app.getHttpServer())
      .get(`/api/v1/sales/${test1SaleId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(saleRes.status).toBe(200);
    const saleData = saleRes.body.data;
    const itemToReturn = saleData.items[0];

    const returnId = uuidv7();
    const returnRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${test1SaleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", returnId)
      .send({
        id: returnId,
        shiftId,
        reason: "Customer size exchange",
        refundMethod: "cash",
        items: [
          {
            saleItemId: itemToReturn.id,
            quantity: 1,
            condition: "resellable",
          },
        ],
      });

    expect(returnRes.status).toBe(201);
    expect(Number(returnRes.body.data.totalRefundMinor)).toBe(176000);
  });
});
