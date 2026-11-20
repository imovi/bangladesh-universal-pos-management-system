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
import { LoyaltyService } from "../src/modules/loyalty/loyalty.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { v7 as uuidv7 } from "uuid";

describe("Milestone E4: Loyalty Points Engine Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let loyaltyService: LoyaltyService;

  let ownerToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let variant2000Id: string;
  let variant5000Id: string;
  let customerId: string;

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
    loyaltyService = app.get(LoyaltyService);

    // 1. Setup Tenant
    const signup = await tenantsService.signup({
      companyName: "Loyalty Test Store",
      slug: "loyalty-test-store",
      businessType: "fashion",
      owner: {
        name: "Store Owner",
        email: "owner@loyaltytest.com",
        phone: "+8801700000099",
        password: "Password123!",
      },
      branch: { name: "Dhaka Branch", code: "DK-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    // Login
    const login = await authService.login({
      tenantSlug: "loyalty-test-store",
      email: "owner@loyaltytest.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;

    // 2. Setup Register, Shift, Products & Customer
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

      const cat = await tx.category.create({
        data: { tenantId, name: "Fashion" },
      });

      const prod = await tx.product.create({
        data: { tenantId, categoryId: cat.id, name: "Saree Collection" },
      });

      const v1 = await tx.productVariant.create({
        data: {
          tenantId,
          productId: prod.id,
          sku: "SAREE-2000",
          priceMinor: 200000n, // ৳2,000
          costMinor: 100000n,
        },
      });
      variant2000Id = v1.id;

      const v2 = await tx.productVariant.create({
        data: {
          tenantId,
          productId: prod.id,
          sku: "SAREE-5000",
          priceMinor: 500000n, // ৳5,000
          costMinor: 250000n,
        },
      });
      variant5000Id = v2.id;

      // Initial stock
      await tx.stockLevel.createMany({
        data: [
          { tenantId, branchId, variantId: v1.id, qty: 100 },
          { tenantId, branchId, variantId: v2.id, qty: 100 },
        ],
      });

      // Customer
      const cust = await tx.customer.create({
        data: {
          tenantId,
          name: "Tahmina Akter",
          phone: "+8801711223344",
          loyaltyPointsBalance: 0,
        },
      });
      customerId = cust.id;
    });

    // 3. Configure Loyalty Settings:
    // earnRateMinor: 10000n (৳100 per 1 point)
    // pointValueMinor: 100n (৳1.00 per point)
    // minRedeemPoints: 50
    // maxBillSharePercent: 50
    // expiryMonths: 12
    const res = await request(app.getHttpServer())
      .patch("/api/v1/settings/loyalty")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        isEnabled: true,
        earnRateMinor: 10000,
        pointValueMinor: 100,
        minRedeemPoints: 50,
        maxBillSharePercent: 50,
        expiryMonths: 12,
      });
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Earn points on sale: customer purchases items and receives points in ledger and cached balance", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        customerId,
        items: [{ variantId: variant2000Id, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 200000 }],
        expectedTotalMinor: 200000, // ৳2,000
      });

    expect(res.status).toBe(201);

    // Verify Customer balance: 200,000 / 10,000 = 20 points
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const cust = await tx.customer.findUnique({ where: { id: customerId } });
      expect(cust?.loyaltyPointsBalance).toBe(20);

      const ledger = await tx.loyaltyLedger.findMany({
        where: { customerId, saleId },
      });
      expect(ledger.length).toBe(1);
      expect(ledger[0].type).toBe("EARN");
      expect(ledger[0].points).toBe(20);
      expect(ledger[0].expiresAt).toBeDefined();

      // Check sum(points) == balance
      const sumResult: any[] = await tx.$queryRaw`
        SELECT COALESCE(SUM(points), 0)::int as total
        FROM loyalty_ledger
        WHERE customer_id = ${customerId}::uuid;
      `;
      expect(sumResult[0].total).toBe(20);
    });
  });

  it("2. Negative balance blocks redemption: cannot redeem points when customer has insufficient or negative balance", async () => {
    // Customer has 20 points, but minRedeemPoints is 50
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        customerId,
        pointsRedeemed: 20,
        items: [{ variantId: variant2000Id, quantity: 1 }],
        payments: [
          { paymentMethod: "points", amountMinor: 2000 },
          { paymentMethod: "cash", amountMinor: 198000 },
        ],
        expectedTotalMinor: 200000,
      });

    expect(res.status).toBe(422);
    expect(res.body.error?.code || res.body.code).toBe("EXCEEDS_MAX_REDEEMABLE_POINTS");
  });

  it("3. Earn more points crossing threshold: purchase ৳5,000 to earn 50 points, bringing total to 70", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId,
        branchId,
        customerId,
        items: [{ variantId: variant5000Id, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 500000 }],
        expectedTotalMinor: 500000,
      });

    expect(res.status).toBe(201);

    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const cust = await tx.customer.findUnique({ where: { id: customerId } });
      expect(cust?.loyaltyPointsBalance).toBe(70); // 20 + 50
    });
  });

  it("4. Parallel redemption of the same points: exactly one succeeds and the other fails", async () => {
    // Customer has 70 points.
    // Max bill share is 50% of 200,000 = 100,000 (1000 points).
    // Customer holds 70 points, so max usable = 70 points (৳70 = 7000 minor).
    // Launch two parallel sales each trying to redeem 60 points (6000 minor).
    // Total available is 70 points, so 60 + 60 = 120 points exceeds available!

    const saleIdA = uuidv7();
    const saleIdB = uuidv7();

    const makeSale = (id: string) =>
      request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Idempotency-Key", id)
        .send({
          id,
          shiftId,
          branchId,
          customerId,
          pointsRedeemed: 60,
          items: [{ variantId: variant2000Id, quantity: 1 }],
          payments: [
            { paymentMethod: "points", amountMinor: 6000 },
            { paymentMethod: "cash", amountMinor: 194000 },
          ],
          expectedTotalMinor: 200000,
        });

    const [resA, resB] = await Promise.all([makeSale(saleIdA), makeSale(saleIdB)]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(201);
    expect(statuses.filter((s) => s === 201).length).toBe(1);

    const failed = resA.status === 201 ? resB : resA;
    expect([400, 422]).toContain(failed.status);

    // Verify balance: was 70, redeemed 60, plus points earned on cash portion of successful sale:
    // Cash portion = 194,000 / 10,000 = 19 points earned!
    // Remaining = 70 - 60 + 19 = 29 points.
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const cust = await tx.customer.findUnique({ where: { id: customerId } });
      expect(cust?.loyaltyPointsBalance).toBe(29);

      // Verify cached balance equals ledger sum
      const sumResult: any[] = await tx.$queryRaw`
        SELECT COALESCE(SUM(points), 0)::int as total
        FROM loyalty_ledger
        WHERE customer_id = ${customerId}::uuid;
      `;
      expect(sumResult[0].total).toBe(29);
    });
  });

  it("5. Return with reverse of earned points and refund of redeemed points", async () => {
    // 5a. Create a fresh sale with 100 points redeemed and earn points
    // First give customer 100 points via manual adjustment
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/loyalty/adjust`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        points: 100,
        reason: "Test bonus",
      })
      .expect(200);

    // Balance is now 29 + 100 = 129 points.
    // Create Sale C redeeming 50 points (5000 minor) and paying 195,000 cash (earns 19 points).
    const saleIdC = uuidv7();
    const resSale = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleIdC)
      .send({
        id: saleIdC,
        shiftId,
        branchId,
        customerId,
        pointsRedeemed: 50,
        items: [{ variantId: variant2000Id, quantity: 1 }],
        payments: [
          { paymentMethod: "points", amountMinor: 5000 },
          { paymentMethod: "cash", amountMinor: 195000 },
        ],
        expectedTotalMinor: 200000,
      });
    expect(resSale.status).toBe(201);

    // Full return on Sale C
    const saleData = resSale.body.data || resSale.body;
    const saleItemId = saleData.items[0].id;
    const returnId = uuidv7();
    const resReturn = await request(app.getHttpServer())
      .post(`/api/v1/sales/${saleIdC}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", returnId)
      .send({
        id: returnId,
        shiftId,
        items: [
          {
            saleItemId,
            quantity: 1,
            condition: "resellable",
          },
        ],
        refundMethod: "cash",
      });
    expect(resReturn.status).toBe(201);

    // Check ledger entries for Return
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const returnEntries = await tx.loyaltyLedger.findMany({
        where: { customerId, returnId },
      });

      // Should have REVERSE_EARN (reversing the 19 points earned) and REFUND_REDEEM (refunding the 50 points redeemed)
      const reverseEarn = returnEntries.find((e) => e.type === "REVERSE_EARN");
      const refundRedeem = returnEntries.find((e) => e.type === "REFUND_REDEEM");

      expect(reverseEarn).toBeDefined();
      expect(reverseEarn?.points).toBe(-19);

      expect(refundRedeem).toBeDefined();
      expect(refundRedeem?.points).toBe(50);

      // Verify ledger sum matches customer balance
      const cust = await tx.customer.findUnique({ where: { id: customerId } });
      const sumResult: any[] = await tx.$queryRaw`
        SELECT COALESCE(SUM(points), 0)::int as total
        FROM loyalty_ledger
        WHERE customer_id = ${customerId}::uuid;
      `;
      expect(sumResult[0].total).toBe(cust?.loyaltyPointsBalance);
    });
  });

  it("6. Expiry FIFO with mixed earn dates, run twice on the same day is idempotent", async () => {
    // Create a new customer for isolated expiry testing
    let expiryCustId: string;
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.create({
        data: {
          tenantId,
          name: "Expiry Customer",
          phone: "+8801799887766",
          loyaltyPointsBalance: 150,
        },
      });
      expiryCustId = c.id;

      const pastDate1 = new Date(Date.now() - 400 * 24 * 3600 * 1000); // 400 days ago (expired)
      const pastDate2 = new Date(Date.now() - 380 * 24 * 3600 * 1000); // 380 days ago (expired)
      const futureDate = new Date(Date.now() + 100 * 24 * 3600 * 1000); // future

      // Batch 1: 50 points expired
      await tx.loyaltyLedger.create({
        data: {
          id: uuidv7(),
          tenantId,
          customerId: c.id,
          type: "EARN",
          points: 50,
          expiresAt: pastDate1,
          createdAt: pastDate1,
        },
      });

      // Batch 2: 50 points expired
      await tx.loyaltyLedger.create({
        data: {
          id: uuidv7(),
          tenantId,
          customerId: c.id,
          type: "EARN",
          points: 50,
          expiresAt: pastDate2,
          createdAt: pastDate2,
        },
      });

      // Batch 3: 50 points active
      await tx.loyaltyLedger.create({
        data: {
          id: uuidv7(),
          tenantId,
          customerId: c.id,
          type: "EARN",
          points: 50,
          expiresAt: futureDate,
          createdAt: new Date(),
        },
      });
    });

    const evalDate = new Date();

    // Run 1: Should expire 100 points
    const run1 = await loyaltyService.expirePointsDaily(evalDate, tenantId);
    expect(run1.expiredCustomersCount).toBe(1);
    expect(run1.totalPointsExpired).toBe(100);

    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: expiryCustId } });
      expect(c?.loyaltyPointsBalance).toBe(50);
    });

    // Run 2: Same day, should be idempotent (0 points expired)
    const run2 = await loyaltyService.expirePointsDaily(evalDate, tenantId);
    expect(run2.totalPointsExpired).toBe(0);

    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: expiryCustId } });
      expect(c?.loyaltyPointsBalance).toBe(50);

      // Verify ledger sum matches
      const sumResult: any[] = await tx.$queryRaw`
        SELECT COALESCE(SUM(points), 0)::int as total
        FROM loyalty_ledger
        WHERE customer_id = ${expiryCustId}::uuid;
      `;
      expect(sumResult[0].total).toBe(50);
    });
  });

  it("7. Offline sale with customer earns points when it syncs, exactly once (idempotent)", async () => {
    let offlineCustId: string;
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.create({
        data: {
          tenantId,
          name: "Offline Sync Customer",
          phone: "+8801755443322",
          loyaltyPointsBalance: 0,
        },
      });
      offlineCustId = c.id;
    });

    const offlineSaleId = uuidv7();
    const offlineInvoiceNumber = "REG01-O-261120-0099";

    const offlinePayload = {
      id: offlineSaleId,
      shiftId,
      branchId,
      customerId: offlineCustId,
      isOffline: true,
      invoiceNumber: offlineInvoiceNumber,
      occurredAt: new Date().toISOString(),
      items: [{ variantId: variant2000Id, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 200000 }],
      expectedTotalMinor: 200000,
    };

    // First sync
    const res1 = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", offlineSaleId)
      .send(offlinePayload);
    expect(res1.status).toBe(201);

    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: offlineCustId } });
      expect(c?.loyaltyPointsBalance).toBe(20);
    });

    // Second sync (idempotent duplicate submission)
    const res2 = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", offlineSaleId)
      .send(offlinePayload);
    expect([200, 201]).toContain(res2.status);

    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const c = await tx.customer.findUnique({ where: { id: offlineCustId } });
      // Points should still be 20, NOT 40
      expect(c?.loyaltyPointsBalance).toBe(20);

      const ledger = await tx.loyaltyLedger.findMany({
        where: { customerId: offlineCustId },
      });
      expect(ledger.length).toBe(1);
    });
  });

  it("8. Shift figures: points payment method appears in method totals and NOT in expected cash", async () => {
    // Open Register 2 with Shift 2 to test shift figures cleanly
    let testShiftId: string;
    await tenantContext.runWithTenant(tenantId, async (tx) => {
      const reg2 = await tx.register.create({
        data: {
          tenantId,
          branchId,
          name: "Register 2",
          code: "REG02",
          allowOffline: true,
        },
      });

      const s = await tx.shift.create({
        data: {
          tenantId,
          branchId,
          registerId: reg2.id,
          cashierUserId: (await tx.user.findFirstOrThrow({ where: { tenantId } })).id,
          openingCashMinor: 10000n, // ৳100
          status: "open",
        },
      });
      testShiftId = s.id;
    });

    // Ensure customer has enough points
    await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/loyalty/adjust`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        points: 200,
        reason: "Shift test points",
      })
      .expect(200);

    // Make a sale in testShift with split: 50 points (5000 minor) and 195,000 cash
    const saleId = uuidv7();
    const resSale = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        shiftId: testShiftId,
        branchId,
        customerId,
        pointsRedeemed: 50,
        items: [{ variantId: variant2000Id, quantity: 1 }],
        payments: [
          { paymentMethod: "points", amountMinor: 5000 },
          { paymentMethod: "cash", amountMinor: 195000 },
        ],
        expectedTotalMinor: 200000,
      });
    expect(resSale.status).toBe(201);

    // Check shift summary
    const resSummary = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${testShiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(resSummary.status).toBe(200);

    const shiftData = resSummary.body.data || resSummary.body;
    const summary = shiftData.summary;

    // Expected cash: opening (10,000) + cash payments (195,000) = 205,000
    // Points payment (5,000) MUST NOT be in expected cash!
    expect(Number(summary.expectedCashMinor)).toBe(205000);

    // Points method must be present in paymentMethodTotalsMinor
    expect(summary.paymentMethodTotalsMinor).toBeDefined();
    expect(Number(summary.paymentMethodTotalsMinor.points)).toBe(5000);
    expect(Number(summary.paymentMethodTotalsMinor.cash)).toBe(195000);
  });
});
