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
import { evaluatePromotions, PromotionRule } from "@universal-pos/shared";
import { v7 as uuidv7 } from "uuid";

describe("Milestone E2: Promotions Back Office & Engine Integration API Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let tenantAToken: string;
  let tenantAId: string;
  let branchAId: string;
  let registerAId: string;
  let shiftAId: string;
  let variantA1Id: string;
  let variantA2Id: string;
  let variantA3Id: string;
  let productAId: string;

  let tenantBToken: string;
  let tenantBId: string;

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

    // 1. Provision Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Artisan Apparel Promotions A",
      slug: "promo-tenant-a",
      businessType: "fashion",
      owner: {
        name: "Promo Owner A",
        email: "owner-a@promo.com",
        phone: "+8801700000081",
        password: "Password123!",
      },
      branch: {
        name: "Dhaka Branch",
        code: "DHK-01",
      },
    });
    tenantAId = signupA.tenantId;
    branchAId = signupA.branchId;

    const loginA = await authService.login({
      tenantSlug: "promo-tenant-a",
      email: "owner-a@promo.com",
      password: "Password123!",
    });
    tenantAToken = loginA.accessToken;

    // 2. Provision Tenant B
    const signupB = await tenantsService.signup({
      companyName: "Artisan Apparel Promotions B",
      slug: "promo-tenant-b",
      businessType: "fashion",
      owner: {
        name: "Promo Owner B",
        email: "owner-b@promo.com",
        phone: "+8801700000082",
        password: "Password123!",
      },
      branch: {
        name: "Chittagong Branch",
        code: "CTG-01",
      },
    });
    tenantBId = signupB.tenantId;

    const loginB = await authService.login({
      tenantSlug: "promo-tenant-b",
      email: "owner-b@promo.com",
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;

    // 3. Seed Register, Shift and Products for Tenant A
    await tenantContext.runWithTenant(tenantAId, async (tx) => {
      const reg = await tx.register.create({
        data: {
          tenantId: tenantAId,
          branchId: branchAId,
          name: "Register 1",
          code: "REG01",
        },
      });
      registerAId = reg.id;

      const shift = await tx.shift.create({
        data: {
          tenantId: tenantAId,
          branchId: branchAId,
          registerId: registerAId,
          cashierUserId: loginA.user.id,
          status: "open",
          openedAt: new Date(),
          openingCashMinor: 100000n,
        },
      });
      shiftAId = shift.id;

      const prod = await tx.product.create({
        data: {
          tenantId: tenantAId,
          name: "Premium Panjabi Collection",
        },
      });
      productAId = prod.id;

      // Create 3 variants with prices ৳3,000, ৳2,500, ৳2,000
      const v1 = await tx.productVariant.create({
        data: {
          tenantId: tenantAId,
          productId: prod.id,
          sku: "PANJABI-P3000",
          priceMinor: 300000n,
          costMinor: 150000n,
        },
      });
      variantA1Id = v1.id;

      const v2 = await tx.productVariant.create({
        data: {
          tenantId: tenantAId,
          productId: prod.id,
          sku: "PANJABI-P2500",
          priceMinor: 250000n,
          costMinor: 120000n,
        },
      });
      variantA2Id = v2.id;

      const v3 = await tx.productVariant.create({
        data: {
          tenantId: tenantAId,
          productId: prod.id,
          sku: "PANJABI-P2000",
          priceMinor: 200000n,
          costMinor: 100000n,
        },
      });
      variantA3Id = v3.id;

      // Seed initial stock
      for (const vId of [v1.id, v2.id, v3.id]) {
        await tx.stockLevel.create({
          data: {
            tenantId: tenantAId,
            branchId: branchAId,
            variantId: vId,
            qty: 50,
          },
        });
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("CRUD & Lifecycle Management", () => {
    let createdPromoId: string;

    it("creates a new promotion via POST /api/v1/promotions", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/promotions")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          name: "Buy 2 Get 1 Free Eid Offer",
          description: "Cheapest item is 100% free when buying 3 Panjabis",
          type: "BUY_X_GET_Y",
          status: "active",
          priority: 10,
          stackableWithBill: true,
          config: {
            buyQty: 2,
            getQty: 1,
            getDiscountPercentBp: 10000,
          },
          targets: {
            targetType: "ALL",
          },
        })
        .expect(201);

      const body = res.body.data || res.body;
      expect(body.id).toBeDefined();
      expect(body.name).toBe("Buy 2 Get 1 Free Eid Offer");
      expect(body.type).toBe("BUY_X_GET_Y");
      expect(body.status).toBe("active");
      createdPromoId = body.id;
    });

    it("retrieves the promotion list with filters via GET /api/v1/promotions", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/promotions?status=active&type=BUY_X_GET_Y")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const items = res.body.data?.data || res.body.data || res.body;
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0].id).toBe(createdPromoId);
    });

    it("retrieves single promotion detail via GET /api/v1/promotions/:id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/promotions/${createdPromoId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const body = res.body.data || res.body;
      expect(body.id).toBe(createdPromoId);
      expect(body.name).toBe("Buy 2 Get 1 Free Eid Offer");
    });

    it("enforces strict cross-tenant isolation: Tenant B token with Tenant A promo id gives 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/promotions/${createdPromoId}`)
        .set("Authorization", `Bearer ${tenantBToken}`)
        .expect(404);

      expect(res.body.data).toBeFalsy();
    });

    it("updates promotion details via PATCH /api/v1/promotions/:id", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/promotions/${createdPromoId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          description: "Updated description for testing",
          priority: 20,
        })
        .expect(200);

      const body = res.body.data || res.body;
      expect(body.description).toBe("Updated description for testing");
      expect(body.priority).toBe(20);
    });

    it("pauses promotion via POST /api/v1/promotions/:id/pause", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/promotions/${createdPromoId}/pause`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const body = res.body.data || res.body;
      expect(body.status).toBe("paused");
    });

    it("resumes promotion via POST /api/v1/promotions/:id/resume", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/promotions/${createdPromoId}/resume`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const body = res.body.data || res.body;
      expect(body.status).toBe("active");
    });

    it("duplicates promotion via POST /api/v1/promotions/:id/duplicate", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/promotions/${createdPromoId}/duplicate`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(201);

      const body = res.body.data || res.body;
      expect(body.id).toBeDefined();
      expect(body.id).not.toBe(createdPromoId);
      expect(body.name).toContain("(Copy)");
      expect(body.status).toBe("draft");

      // Clean up the duplicated promo
      await request(app.getHttpServer())
        .delete(`/api/v1/promotions/${body.id}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);
    });

    it("ends promotion via POST /api/v1/promotions/:id/end", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/promotions/${createdPromoId}/end`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const body = res.body.data || res.body;
      expect(body.status).toBe("ended");
    });

    it("blocks deletion of ended promotion: returns 400", async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/promotions/${createdPromoId}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(400);
    });
  });

  describe("Preview Calculator Box", () => {
    it("POST /api/v1/promotions/preview calculates exact discount matching shared engine", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/promotions/preview")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          promotion: {
            name: "Eid 20% Off",
            type: "PERCENT_OFF",
            status: "active",
            config: {
              percentBp: 2000, // 20%
            },
            targets: { targetType: "ALL" },
          },
          lines: [
            {
              variantId: variantA1Id,
              productId: productAId,
              unitPriceMinor: 220000, // ৳2,200
              quantity: 2,
            },
          ],
        })
        .expect(200);

      const body = res.body.data || res.body;
      // ৳2,200 × 2 = ৳4,400 gross. 20% off = ৳880 discount. Total = ৳3,520
      expect(Number(body.grossMinor)).toBe(440000);
      expect(Number(body.totalPromotionDiscountMinor)).toBe(88000);
      expect(Number(body.netMinor)).toBe(352000);
    });
  });

  describe("Server Sales Engine Promotion Integration & Stored Numbers", () => {
    let promoBuy2Get1Id: string;

    beforeAll(async () => {
      // Create an active Buy 2 Get 1 promotion
      const res = await request(app.getHttpServer())
        .post("/api/v1/promotions")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .send({
          name: "Eid Buy 2 Get 1 Panjabi",
          type: "BUY_X_GET_Y",
          status: "active",
          priority: 5,
          stackableWithBill: true,
          config: {
            buyQty: 2,
            getQty: 1,
            getDiscountPercentBp: 10000,
          },
          targets: { targetType: "ALL" },
        })
        .expect(201);

      promoBuy2Get1Id = (res.body.data || res.body).id;
    });

    it("verifies sale's stored numbers equal the shared evaluatePromotions result to the poisha", async () => {
      // Buy 3 Panjabis: ৳3,000 + ৳2,500 + ৳2,000 = Gross ৳7,500
      // Cheapest unit is ৳2,000 (free)
      // Spread proportionally across 3000 : 2500 : 2000
      // Proportional discounts: ৳800.00, ৳666.67, ৳533.33
      // Net totals: ৳2,200.00, ৳1,833.33, ৳1,466.67
      // Grand Total = ৳5,500.00
      const saleId = uuidv7();

      // Client computes expected total:
      const clientEval = evaluatePromotions({
        lines: [
          { variantId: variantA1Id, productId: productAId, unitPriceMinor: 300000n, quantity: 1 },
          { variantId: variantA2Id, productId: productAId, unitPriceMinor: 250000n, quantity: 1 },
          { variantId: variantA3Id, productId: productAId, unitPriceMinor: 200000n, quantity: 1 },
        ],
        promotions: [
          {
            id: promoBuy2Get1Id,
            name: "Eid Buy 2 Get 1 Panjabi",
            type: "BUY_X_GET_Y",
            status: "active",
            priority: 5,
            stackableWithBill: true,
            membersOnly: false,
            startAt: new Date("2020-01-01"),
            endAt: new Date("2030-01-01"),
            targetType: "ALL",
            config: { buyQty: 2, getQty: 1, getDiscountPercentBp: 10000 },
          },
        ],
      });

      expect(clientEval.totalMinor).toBe(550000n);
      expect(clientEval.lines[0].promotionDiscountMinor).toBe(80000n);
      expect(clientEval.lines[1].promotionDiscountMinor).toBe(66667n);
      expect(clientEval.lines[2].promotionDiscountMinor).toBe(53333n);

      const createRes = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${tenantAToken}`)
        .set("Idempotency-Key", saleId)
        .send({
          id: saleId,
          shiftId: shiftAId,
          branchId: branchAId,
          expectedTotalMinor: Number(clientEval.totalMinor),
          items: [
            { variantId: variantA1Id, quantity: 1, unitPriceMinor: 300000 },
            { variantId: variantA2Id, quantity: 1, unitPriceMinor: 250000 },
            { variantId: variantA3Id, quantity: 1, unitPriceMinor: 200000 },
          ],
          payments: [
            { paymentMethod: "cash", amountMinor: Number(clientEval.totalMinor) },
          ],
        });

      if (createRes.status !== 201) {
        console.error("CREATE SALE ERROR:", JSON.stringify(createRes.body, null, 2));
      }
      expect(createRes.status).toBe(201);

      const savedSale = createRes.body.data || createRes.body;
      expect(Number(savedSale.totalMinor)).toBe(550000);
      expect(Number(savedSale.discountMinor)).toBe(200000);

      // Verify stored items in DB
      const items = savedSale.items;
      expect(items).toHaveLength(3);

      const item1 = items.find((i: any) => i.variantId === variantA1Id);
      const item2 = items.find((i: any) => i.variantId === variantA2Id);
      const item3 = items.find((i: any) => i.variantId === variantA3Id);

      expect(item1.promotionId).toBe(promoBuy2Get1Id);
      expect(Number(item1.promotionDiscountMinor)).toBe(80000);
      expect(Number(item1.totalMinor)).toBe(220000); // 3000 - 800 = 2200

      expect(item2.promotionId).toBe(promoBuy2Get1Id);
      expect(Number(item2.promotionDiscountMinor)).toBe(66667);
      expect(Number(item2.totalMinor)).toBe(183333); // 2500 - 666.67 = 1833.33

      expect(item3.promotionId).toBe(promoBuy2Get1Id);
      expect(Number(item3.promotionDiscountMinor)).toBe(53333);
      expect(Number(item3.totalMinor)).toBe(146667); // 2000 - 533.33 = 1466.67

      // Verify Promotion usage statistics updated on Promotion table
      const promoCheck = await request(app.getHttpServer())
        .get(`/api/v1/promotions/${promoBuy2Get1Id}`)
        .set("Authorization", `Bearer ${tenantAToken}`)
        .expect(200);

      const promoData = promoCheck.body.data || promoCheck.body;
      expect(promoData.totalUses).toBe(1);
      expect(Number(promoData.totalDiscountMinor)).toBe(200000);
    });
  });
});
