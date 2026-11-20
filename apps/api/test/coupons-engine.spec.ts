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

describe("Milestone E3: Coupons Engine & Concurrency Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let ownerToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let variant2000Id: string;
  let variant3000Id: string;
  let customerId: string;

  let promoThresholdId: string;

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
      companyName: "Coupons Test Store",
      slug: "coupons-test-store",
      businessType: "fashion",
      owner: {
        name: "Store Owner",
        email: "owner@couponstest.com",
        phone: "+8801700000088",
        password: "Password123!",
      },
      branch: { name: "Dhaka Branch", code: "DK-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    // Login
    const login = await authService.login({
      tenantSlug: "coupons-test-store",
      email: "owner@couponstest.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;

    // 2. Setup Register & Open Shift
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const reg = await tx.register.create({
        data: {
          tenantId,
          branchId,
          name: "Register 1",
          code: "REG01",
          allowOffline: true,
        },
      });
      registerId = reg.id;

      const shift = await tx.shift.create({
        data: {
          tenantId,
          branchId,
          registerId: reg.id,
          cashierUserId: signup.ownerId,
          openingCashMinor: 50000n,
          status: "open",
        },
      });
      shiftId = shift.id;

      // Create Category
      const cat = await tx.category.create({
        data: { tenantId, name: "Fashion" },
      });

      // Create Product & 2 Variants (৳2,000 and ৳3,000)
      const prod = await tx.product.create({
        data: { tenantId, categoryId: cat.id, name: "Panjabi Collection" },
      });

      const v1 = await tx.productVariant.create({
        data: {
          tenantId,
          productId: prod.id,
          sku: "PANJABI-2000",
          priceMinor: 200000n, // ৳2,000
          costMinor: 100000n,
        },
      });
      variant2000Id = v1.id;

      const v2 = await tx.productVariant.create({
        data: {
          tenantId,
          productId: prod.id,
          sku: "PANJABI-3000",
          priceMinor: 300000n, // ৳3,000
          costMinor: 150000n,
        },
      });
      variant3000Id = v2.id;

      // Seed Stock
      await tx.stockLevel.createMany({
        data: [
          { tenantId, branchId, variantId: v1.id, qty: 100 },
          { tenantId, branchId, variantId: v2.id, qty: 100 },
        ],
      });

      // Create Customer
      const cust = await tx.customer.create({
        data: {
          tenantId,
          name: "Loyal Shopper",
          phone: "+8801811112222",
        },
      });
      customerId = cust.id;
    });

    // 3. Create active Bill Promotion: Spend ৳5,000 get ৳500 off (or 10% off)
    const promoRes = await request(app.getHttpServer())
      .post("/api/v1/promotions")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Eid ৳500 Coupon Offer",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 50,
        stackableWithBill: true,
        config: {
          thresholdMinor: 400000, // ৳4,000 threshold
          discountType: "AMOUNT",
          amountMinor: 50000, // ৳500 off
        },
        targets: { targetType: "ALL" },
        conditions: { couponRequired: true },
      });
    expect(promoRes.status).toBe(201);
    promoThresholdId = promoRes.body.data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("1. Batch generation of N codes and CSV export format", async () => {
    const genRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons/generate`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        count: 5,
        prefix: "EID",
        usageLimitTotal: 1,
        usageLimitPerCustomer: 1,
      });
    expect(genRes.status).toBe(201);
    const codes = genRes.body.data;
    expect(codes).toHaveLength(5);
    expect(codes[0].code).toMatch(/^EID-[A-Z0-9]{8}$/);
    expect(codes[0].usageLimitTotal).toBe(1);

    const exportRes = await request(app.getHttpServer())
      .get(`/api/v1/promotions/${promoThresholdId}/coupons/export`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.headers["content-type"]).toContain("text/csv");
    expect(exportRes.text).toContain("Code,Usage Limit Total,Times Used,Limit Per Customer,Expires At,Active,Created At");
    expect(exportRes.text).toContain(codes[0].code);
  });

  it("2. Parallel use of the last code use: Promise.all, exactly one succeeds, and the count equals the limit", async () => {
    // Create a coupon with usageLimitTotal = 1
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code: "SINGLEUSE500",
        usageLimitTotal: 1,
        usageLimitPerCustomer: 1,
      });
    expect(createRes.status).toBe(201);

    // Prepare 2 identical carts qualifying for the coupon (৳2,000 + ৳3,000 = ৳5,000 gross > ৳4,000 threshold, expected total ৳4,500)
    const salePayload1 = {
      id: uuidv7(),
      branchId,
      shiftId,
      customerId,
      couponCode: "SINGLEUSE500",
      items: [
        { variantId: variant2000Id, quantity: 1 },
        { variantId: variant3000Id, quantity: 1 },
      ],
      expectedTotalMinor: 450000, // ৳5000 - ৳500 promo = ৳4500
      payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
    };

    const salePayload2 = {
      id: uuidv7(),
      branchId,
      shiftId,
      customerId,
      couponCode: "SINGLEUSE500",
      items: [
        { variantId: variant2000Id, quantity: 1 },
        { variantId: variant3000Id, quantity: 1 },
      ],
      expectedTotalMinor: 450000,
      payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
    };

    // Execute concurrently
    const [res1, res2] = await Promise.all([
      request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Idempotency-Key", salePayload1.id)
        .send(salePayload1),
      request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Idempotency-Key", salePayload2.id)
        .send(salePayload2),
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain(201);
    expect(statuses).toContain(422);

    const failedRes = res1.status === 422 ? res1 : res2;
    expect(failedRes.body.error.code).toBe("COUPON_LIMIT_REACHED");

    // Check DB count: times_used must be exactly 1
    const couponInDb = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.coupon.findUnique({ where: { tenantId_code: { tenantId, code: "SINGLEUSE500" } } });
    });
    expect(couponInDb?.timesUsed).toBe(1);
  });

  it("3. Idempotent retry of the same sale does not count a use twice", async () => {
    // Create a coupon with usageLimitTotal = 2
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code: "IDEMPOTENT500",
        usageLimitTotal: 2,
      });
    expect(createRes.status).toBe(201);

    const saleId = uuidv7();
    const payload = {
      id: saleId,
      branchId,
      shiftId,
      couponCode: "IDEMPOTENT500",
      items: [
        { variantId: variant2000Id, quantity: 1 },
        { variantId: variant3000Id, quantity: 1 },
      ],
      expectedTotalMinor: 450000,
      payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
    };

    // Send 1st attempt
    const res1 = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload);
    expect(res1.status).toBe(201);

    // Send 2nd attempt with exact same payload & saleId
    const res2 = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send(payload);
    expect([200, 201]).toContain(res2.status);

    // timesUsed must still be 1!
    const couponInDb = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.coupon.findUnique({ where: { tenantId_code: { tenantId, code: "IDEMPOTENT500" } } });
    });
    expect(couponInDb?.timesUsed).toBe(1);
  });

  it("4. A full return gives the use back, and a partial return does not", async () => {
    // Create a coupon with usageLimitTotal = 1
    const createRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code: "RETURN500",
        usageLimitTotal: 1,
      });
    expect(createRes.status).toBe(201);

    // Sale of 2 items
    const saleId = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        branchId,
        shiftId,
        couponCode: "RETURN500",
        items: [
          { variantId: variant2000Id, quantity: 1 },
          { variantId: variant3000Id, quantity: 1 },
        ],
        expectedTotalMinor: 450000,
        payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
      });
    expect(saleRes.status).toBe(201);
    const saleData = saleRes.body.data;
    const item1 = saleData.items[0];
    const item2 = saleData.items[1];

    let couponDb = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.coupon.findUnique({ where: { tenantId_code: { tenantId, code: "RETURN500" } } });
    });
    expect(couponDb?.timesUsed).toBe(1);

    // Step A: Partial return (only 1st item)
    const partialReturnId = uuidv7();
    const partialReturnRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", partialReturnId)
      .send({
        id: partialReturnId,
        shiftId,
        refundMethod: "cash",
        reason: "Customer partial return",
        items: [{ saleItemId: item1.id, quantity: 1, condition: "resellable" }],
      });
    expect(partialReturnRes.status).toBe(201);

    // After partial return: timesUsed must REMAIN 1
    couponDb = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.coupon.findUnique({ where: { tenantId_code: { tenantId, code: "RETURN500" } } });
    });
    expect(couponDb?.timesUsed).toBe(1);

    // Step B: Complete return (return 2nd item so entire sale is now returned)
    const fullReturnId = uuidv7();
    const fullReturnRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleId}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", fullReturnId)
      .send({
        id: fullReturnId,
        shiftId,
        refundMethod: "cash",
        reason: "Customer returned remaining item",
        items: [{ saleItemId: item2.id, quantity: 1, condition: "resellable" }],
      });
    expect(fullReturnRes.status).toBe(201);

    // After full return: timesUsed must be restored to 0!
    couponDb = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.coupon.findUnique({ where: { tenantId_code: { tenantId, code: "RETURN500" } } });
    });
    expect(couponDb?.timesUsed).toBe(0);
  });

  it("5. Offline: unlimited code syncs cleanly, limited code exceeded gets COUPON_LIMIT_EXCEEDED", async () => {
    // 5A: Unlimited coupon
    const unlRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code: "UNLIMITED500",
        usageLimitTotal: null,
        usageLimitPerCustomer: null,
      });
    expect(unlRes.status).toBe(201);

    const unlSaleId = uuidv7();
    const offlineUnlSaleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", unlSaleId)
      .send({
        id: unlSaleId,
        branchId,
        shiftId,
        invoiceNumber: "REG01-O-261120-0010",
        isOffline: true,
        occurredAt: new Date().toISOString(),
        couponCode: "UNLIMITED500",
        billPromotionId: promoThresholdId,
        billPromotionDiscountMinor: 50000,
        items: [
          { variantId: variant2000Id, quantity: 1, unitPriceMinor: 200000 },
          { variantId: variant3000Id, quantity: 1, unitPriceMinor: 300000 },
        ],
        expectedTotalMinor: 450000,
        payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
      });
    expect(offlineUnlSaleRes.status).toBe(201);

    // 5B: Limited coupon with limit 0 (or limit already reached = 1)
    const limRes = await request(app.getHttpServer())
      .post(`/api/v1/promotions/${promoThresholdId}/coupons`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        code: "EXCEEDED500",
        usageLimitTotal: 1,
      });
    expect(limRes.status).toBe(201);

    // Exhaust the coupon online first
    const burnSaleId = uuidv7();
    const burnRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", burnSaleId)
      .send({
        id: burnSaleId,
        branchId,
        shiftId,
        couponCode: "EXCEEDED500",
        items: [
          { variantId: variant2000Id, quantity: 1 },
          { variantId: variant3000Id, quantity: 1 },
        ],
        expectedTotalMinor: 450000,
        payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
      });
    expect(burnRes.status).toBe(201);

    // Now an offline sale syncs using EXCEEDED500: must be ACCEPTED, not rejected, and flagged COUPON_LIMIT_EXCEEDED
    const exceededSaleId = uuidv7();
    const offlineExceededSaleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", exceededSaleId)
      .send({
        id: exceededSaleId,
        branchId,
        shiftId,
        invoiceNumber: "REG01-O-261120-0011",
        isOffline: true,
        occurredAt: new Date().toISOString(),
        couponCode: "EXCEEDED500",
        billPromotionId: promoThresholdId,
        billPromotionDiscountMinor: 50000,
        items: [
          { variantId: variant2000Id, quantity: 1, unitPriceMinor: 200000 },
          { variantId: variant3000Id, quantity: 1, unitPriceMinor: 300000 },
        ],
        expectedTotalMinor: 450000,
        payments: [{ paymentMethod: "cash", amountMinor: 450000 }],
      });
    expect(offlineExceededSaleRes.status).toBe(201);

    // Verify review flag created
    const flagsRes = await request(app.getHttpServer())
      .get("/api/v1/sales/offline-review")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(flagsRes.status).toBe(200);
    const flags = flagsRes.body.data?.items || flagsRes.body.data || [];
    const couponFlag = flags.find((f: any) => f.flag === "COUPON_LIMIT_EXCEEDED");
    expect(couponFlag).toBeDefined();
    expect(couponFlag.details.couponCode).toBe("EXCEEDED500");
  });
});
