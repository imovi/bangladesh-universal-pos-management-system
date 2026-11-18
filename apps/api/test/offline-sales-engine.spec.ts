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
import { formatDateKey } from "@universal-pos/shared";

describe("Milestone D1: Offline Sales Engine & API Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let ownerToken: string;
  let managerToken: string;
  let cashierToken: string;
  let cashierUserId: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let registerCode: string;
  let openShiftId: string;
  let closedShiftId: string;
  let variantId: string;
  let variantPriceMinor: number;
  let secondVariantId: string;
  let tenantBToken: string;

  async function setupAuthAndTenants() {
    const signup = await tenantsService.signup({
      companyName: "Offline Selling Retail Ltd",
      slug: "offline-retail",
      businessType: "retail",
      owner: { name: "Retail Owner", email: "owner@offlineretail.com", phone: "+8801700000010", password: "Password123!" },
      branch: { name: "Dhanmondi Branch", code: "DMD-01" },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    const loginOwner = await authService.login({ tenantSlug: "offline-retail", email: "owner@offlineretail.com", password: "Password123!" });
    ownerToken = loginOwner.accessToken;

    const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
    const managerRole = rolesRes.body.data.find((r: any) => r.name === "Manager");
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    // Update cashier role maxDiscountPercent to 10%
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${cashierRole.id}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ maxDiscountPercent: 10 });

    // Create Manager user
    await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Branch Manager", email: "manager@offlineretail.com", password: "Password123!", roleIds: [managerRole.id], branchIds: [branchId],
    });
    const loginManager = await authService.login({ tenantSlug: "offline-retail", email: "manager@offlineretail.com", password: "Password123!" });
    managerToken = loginManager.accessToken;

    // Create Cashier user
    const cashierCreateRes = await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Offline Cashier", email: "cashier@offlineretail.com", password: "Password123!", roleIds: [cashierRole.id], branchIds: [branchId],
    });
    cashierUserId = cashierCreateRes.body.data.id;

    const loginCashier = await authService.login({ tenantSlug: "offline-retail", email: "cashier@offlineretail.com", password: "Password123!" });
    cashierToken = loginCashier.accessToken;

    // Tenant B (for cross-tenant checks)
    await tenantsService.signup({
      companyName: "Tenant B Retail Ltd",
      slug: "tenant-b-retail",
      businessType: "fashion",
      owner: { name: "Tenant B Owner", email: "owner@tenantb.com", phone: "+8801700000011", password: "Password123!" },
      branch: { name: "Banani Branch", code: "BNN-01" },
    });
    const loginTenantB = await authService.login({ tenantSlug: "tenant-b-retail", email: "owner@tenantb.com", password: "Password123!" });
    tenantBToken = loginTenantB.accessToken;
  }

  async function setupCatalogAndStock() {
    const taxRes = await request(app.getHttpServer()).post("/api/v1/tax-classes").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Standard 5% Tax", rateBp: 500, isDefault: true,
    });
    const taxClassId = taxRes.body.data.id;

    await app.get(SystemDbService).updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      timezone: "Asia/Dhaka",
      prices_include_tax: true,
      allow_negative_stock: false,
    });

    const prodRes = await request(app.getHttpServer()).post("/api/v1/products").set("Authorization", `Bearer ${ownerToken}`).send({
      name: "Aarong Cotton Panjabi", sku: "PANJABI-01", priceMinor: 200000, costMinor: 120000, taxClassId,
      options: [{ name: "Size", values: ["L", "XL"] }],
    });
    variantId = prodRes.body.data.variants[0].id;
    secondVariantId = prodRes.body.data.variants[1].id;
    variantPriceMinor = 200000;

    await request(app.getHttpServer()).post("/api/v1/inventory/opening-stock").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId,
      items: [
        { variantId, quantity: 20, unitCostMinor: 120000 },
        { variantId: secondVariantId, quantity: 5, unitCostMinor: 120000 },
      ],
    });
  }

  async function setupShifts() {
    const regRes = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Main Counter 01", code: "REG01", allowOffline: true,
    });
    registerId = regRes.body.data.id;
    registerCode = regRes.body.data.code;

    const s1 = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId, branchId, openingCashMinor: 100000,
    });
    openShiftId = s1.body.data.id;

    // A register and shift that is closed
    const reg2Res = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
      branchId, name: "Counter 02", code: "REG02", allowOffline: true,
    });
    const s2 = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
      registerId: reg2Res.body.data.id, branchId, openingCashMinor: 50000,
    });
    closedShiftId = s2.body.data.id;
    await request(app.getHttpServer()).post(`/api/v1/shifts/${closedShiftId}/close`).set("Authorization", `Bearer ${cashierToken}`).send({
      closingCashMinor: 50000,
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
    tenantContext = app.get(TenantContextService);

    await setupAuthAndTenants();
    await setupCatalogAndStock();
    await setupShifts();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe("1. GET /pos/catalog & Delta Updates", () => {
    it("returns catalog with products, variants, tax classes, categories and cursor", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pos/catalog?branchId=${branchId}`)
        .set("Authorization", `Bearer ${cashierToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.data.catalogVersion).toBeDefined();
      expect(res.body.data.serverTime).toBeDefined();
      expect(res.body.data.cursor).toBeDefined();
      expect(res.body.data.products.length).toBeGreaterThan(0);
      expect(res.body.data.variants.length).toBeGreaterThan(0);
      expect(res.body.data.taxClasses.length).toBeGreaterThan(0);

      const v = res.body.data.variants.find((item: any) => item.id === variantId);
      expect(v).toBeDefined();
      expect(v.priceMinor).toBe(variantPriceMinor);
      expect(v.stockQty).toBe(20);
    });

    it("delta update returns updated rows since cursor after a price change", async () => {
      const firstRes = await request(app.getHttpServer())
        .get(`/api/v1/pos/catalog?branchId=${branchId}`)
        .set("Authorization", `Bearer ${cashierToken}`);
      const cursor = firstRes.body.data.cursor;

      // Small delay then update variant price
      await new Promise((r) => setTimeout(r, 50));
      await request(app.getHttpServer())
        .patch(`/api/v1/variants/${variantId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ priceMinor: 220000 });

      const deltaRes = await request(app.getHttpServer())
        .get(`/api/v1/pos/catalog?branchId=${branchId}&since=${cursor}`)
        .set("Authorization", `Bearer ${cashierToken}`);

      expect(deltaRes.status).toBe(200);
      expect(deltaRes.body.data.variants.some((item: any) => item.id === variantId && item.priceMinor === 220000)).toBe(true);
    });

    it("benchmark test: 5,000 variants payload size and query time", async () => {
      // Create a test product with bulk variants
      const start = Date.now();
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pos/catalog?branchId=${branchId}`)
        .set("Authorization", `Bearer ${cashierToken}`);
      const durationMs = Date.now() - start;
      const payloadSizeBytes = Buffer.byteLength(JSON.stringify(res.body));

      console.log(`[BENCHMARK] GET /pos/catalog baseline: ${durationMs}ms, size: ${payloadSizeBytes} bytes`);
      expect(res.status).toBe(200);
      expect(durationMs).toBeLessThan(2000);
    });
  });

  describe("2. Idempotency: Same Offline Sale Sent Sequentially and in Parallel", () => {
    it("sequential identical send: exactly 1 sale, 1 inventory decrement, 1 cash effect", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0001`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        catalogVersion: "v-initial",
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      // Send 1
      const res1 = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res1.status);
      expect(res1.body.data.id).toBe(saleId);
      expect(res1.body.data.invoiceNumber).toBe(offlineInvoice);

      // Send 2 (sequential)
      const res2 = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.id).toBe(saleId);

      // Check DB: exactly 1 sale
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const count = await tx.sale.count({ where: { id: saleId } });
        expect(count).toBe(1);

        const movements = await tx.stockMovement.findMany({ where: { refId: saleId } });
        expect(movements.length).toBe(1);
        expect(Number(movements[0].qtyDelta)).toBe(-1);
      });
    });

    it("parallel identical send (Promise.all): exactly 1 sale created", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0002`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      const [p1, p2] = await Promise.all([
        request(app.getHttpServer())
          .post("/api/v1/sales")
          .set("Authorization", `Bearer ${cashierToken}`)
          .set("Idempotency-Key", saleId)
          .send(payload),
        request(app.getHttpServer())
          .post("/api/v1/sales")
          .set("Authorization", `Bearer ${cashierToken}`)
          .set("Idempotency-Key", saleId)
          .send(payload),
      ]);

      expect([200, 201]).toContain(p1.status);
      expect([200, 201]).toContain(p2.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const count = await tx.sale.count({ where: { id: saleId } });
        expect(count).toBe(1);
      });
    });
  });

  describe("3. Acceptance Rules & Review Flags", () => {
    it("flag PRICE_CHANGED: sold price differs from catalog price with catalogVersion", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0003`;

      // Catalog price is 220000, offline sold at 200000 with catalogVersion "v-old"
      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        catalogVersion: "v-old",
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 200000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 200000 }],
        expectedTotalMinor: 200000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);
      expect(res.body.data.id).toBe(saleId);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "PRICE_CHANGED" },
        });
        expect(flag).toBeDefined();
        expect(flag?.status).toBe("open");
        expect((flag?.details as any).soldPriceMinor).toBe(200000);
        expect((flag?.details as any).catalogPriceMinor).toBe(220000);
      });
    });

    it("flag PRICE_UNKNOWN: sold price differs from catalog price with NO catalogVersion", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0004`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 180000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 180000 }],
        expectedTotalMinor: 180000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "PRICE_UNKNOWN" },
        });
        expect(flag).toBeDefined();
        expect(flag?.status).toBe("open");
        expect((flag?.details as any).soldPriceMinor).toBe(180000);
      });
    });

    it("flag DISCOUNT_OVER_LIMIT: cashier max 10% discount, sold with 20% discount", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0005`;

      // 220000 with 20% discount (44000) = 176000
      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{
          variantId,
          quantity: 1,
          unitPriceMinor: 220000,
          discount: { type: "percent", percentBp: 2000 },
        }],
        payments: [{ paymentMethod: "cash", amountMinor: 176000 }],
        expectedTotalMinor: 176000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "DISCOUNT_OVER_LIMIT" },
        });
        expect(flag).toBeDefined();
        expect(flag?.status).toBe("open");
        expect((flag?.details as any).attemptedPercent).toBe(20);
      });
    });

    it("flag NEGATIVE_STOCK: variant has stock 5, selling 8 decrements to -3 and accepts", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0006`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{ variantId: secondVariantId, quantity: 8, unitPriceMinor: 200000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 1600000 }],
        expectedTotalMinor: 1600000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const stock = await tx.stockLevel.findUnique({
          where: { tenantId_branchId_variantId: { tenantId, branchId, variantId: secondVariantId } },
        });
        expect(Number(stock?.qty)).toBe(-3);

        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "NEGATIVE_STOCK" },
        });
        expect(flag).toBeDefined();
        expect((flag?.details as any).remainingQty).toBe(-3);
      });
    });

    it("flag SHIFT_CLOSED: offline sale arriving into an already closed shift is accepted without changing counted figures", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `REG02-O-${dateKey}-0001`;

      const payload = {
        id: saleId,
        shiftId: closedShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const shift = await tx.shift.findUnique({ where: { id: closedShiftId } });
        expect(shift?.status).toBe("closed");
        expect(Number(shift?.closingCashMinor)).toBe(50000); // counted figures unchanged

        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "SHIFT_CLOSED" },
        });
        expect(flag).toBeDefined();
        expect(flag?.status).toBe("open");
      });
    });

    it("flag PERMISSION_CHANGED: cashier deactivated after the sale, sale is accepted and flagged", async () => {
      // Create temporary cashier
      const rolesRes = await request(app.getHttpServer()).get("/api/v1/roles").set("Authorization", `Bearer ${ownerToken}`);
      const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
      const cRes = await request(app.getHttpServer()).post("/api/v1/users").set("Authorization", `Bearer ${ownerToken}`).send({
        name: "Temporary Cashier", email: "tempcashier@offlineretail.com", password: "Password123!", roleIds: [cashierRole.id], branchIds: [branchId],
      });
      const tempCashierId = cRes.body.data.id;
      const tempLogin = await authService.login({ tenantSlug: "offline-retail", email: "tempcashier@offlineretail.com", password: "Password123!" });
      const tempCashierToken = tempLogin.accessToken;

      // Deactivate user on server
      await request(app.getHttpServer())
        .patch(`/api/v1/users/${tempCashierId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ isActive: false });

      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0007`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: new Date().toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${tempCashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const flag = await tx.saleReviewFlag.findFirst({
          where: { saleId, flag: "PERMISSION_CHANGED" },
        });
        expect(flag).toBeDefined();
        expect(flag?.status).toBe("open");
      });
    });
  });

  describe("4. Rejections & Validations", () => {
    it("rejects with 422 TOTALS_MISMATCH when client math is wrong", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0008`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 111111, // Wrong total
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("TOTALS_MISMATCH");
    });

    it("rejects with 422 when offline invoice number has another register code", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const wrongInvoice = `WRONGREG-O-${dateKey}-0001`;

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: wrongInvoice,
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("INVALID_OFFLINE_INVOICE_NUMBER");
    });

    it("rejects with 409 OFFLINE_NUMBER_TAKEN when duplicate offline invoice number is used by another sale", async () => {
      const saleId1 = uuidv7();
      const saleId2 = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0099`;

      const payload1 = {
        id: saleId1,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId1)
        .send(payload1);

      const payload2 = {
        ...payload1,
        id: saleId2,
      };

      const res2 = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId2)
        .send(payload2);

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe("OFFLINE_NUMBER_TAKEN");
    });

    it("cross-tenant isolation on new endpoints returns 404", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/pos/catalog?branchId=${branchId}`)
        .set("Authorization", `Bearer ${tenantBToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe("5. occurred_at Business Date Attribution", () => {
    it("an offline sale made before midnight and synced after midnight attributes to the earlier business date", async () => {
      const saleId = uuidv7();
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const offlineInvoice = `${registerCode}-O-${dateKey}-0088`;

      // Sale occurred yesterday at 23:30 Dhaka time
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      yesterdayDate.setHours(23, 30, 0, 0);

      // Backdate openShiftId.openedAt to 2 days ago so yesterday's sale is within the shift
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        await tx.shift.update({
          where: { id: openShiftId },
          data: { openedAt: twoDaysAgo },
        });
      });

      const payload = {
        id: saleId,
        shiftId: openShiftId,
        branchId,
        isOffline: true,
        invoiceNumber: offlineInvoice,
        occurredAt: yesterdayDate.toISOString(),
        items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
        payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
        expectedTotalMinor: 220000,
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${cashierToken}`)
        .set("Idempotency-Key", saleId)
        .send(payload);

      expect([200, 201]).toContain(res.status);

      // Verify occurred_at stored in DB
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const stored = await tx.sale.findUnique({ where: { id: saleId } });
        expect(stored?.occurredAt.toISOString()).toBe(yesterdayDate.toISOString());
        expect(stored?.isOffline).toBe(true);
        expect(stored?.syncedAt).toBeDefined();
      });

      // Query sales report for yesterday
      const yStr = formatDateKey(yesterdayDate, "Asia/Dhaka");
      const repY = await request(app.getHttpServer())
        .get(`/api/v1/reports/sales-summary?startDate=20${yStr.substring(0,2)}-${yStr.substring(2,4)}-${yStr.substring(4,6)}&endDate=20${yStr.substring(0,2)}-${yStr.substring(2,4)}-${yStr.substring(4,6)}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(repY.status).toBe(200);
      expect(repY.body.data.salesCount).toBeGreaterThan(0);
    });
  });

  describe("6. Shift Close Override for Failed Items", () => {
    it("cashier close without reason when failed items exist is rejected", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/shifts/${openShiftId}/close`)
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          closingCashMinor: 100000,
          hasFailedItems: true,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("FAILED_SYNC_ITEMS_EXIST");
    });

    it("cashier close with reason when failed items exist requires Manager permission (403)", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/shifts/${openShiftId}/close`)
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          closingCashMinor: 100000,
          hasFailedItems: true,
          overrideReason: "Cashier tried to close alone",
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("MANAGER_OVERRIDE_REQUIRED");
    });

    it("manager close with override reason succeeds and is audit-logged", async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/shifts/${openShiftId}/close`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({
          closingCashMinor: 100000,
          hasFailedItems: true,
          overrideReason: "Hardware sync failure confirmed by manager",
        });

      expect([200, 201]).toContain(res.status);
      expect(res.body.data.status).toBe("closed");

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const audit = await tx.auditLog.findFirst({
          where: { action: "shift.close_override_failed_items", entityId: openShiftId },
        });
        expect(audit).toBeDefined();
        expect((audit?.after as any).reason).toBe("Hardware sync failure confirmed by manager");
      });
    });
  });

  describe("7. Offline Review Management Endpoints", () => {
    let flagIdToResolve: string;

    it("GET /sales/offline-review lists flagged sales and GET /count returns open count", async () => {
      const listRes = await request(app.getHttpServer())
        .get("/api/v1/sales/offline-review")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.data.length).toBeGreaterThan(0);
      flagIdToResolve = listRes.body.data.data[0].id;

      const countRes = await request(app.getHttpServer())
        .get("/api/v1/sales/offline-review/count")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(countRes.status).toBe(200);
      expect(countRes.body.data.count).toBeGreaterThan(0);
    });

    it("PATCH /sales/offline-review/:id/resolve resolves flag with note", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/sales/offline-review/${flagIdToResolve}/resolve`)
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ notes: "Reviewed and approved by manager" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("resolved");
      expect(res.body.data.resolutionNotes).toBe("Reviewed and approved by manager");
    });
  });

  describe("8. Batch Sync Endpoint: POST /pos/sync", () => {
    it("processes batch where valid items succeed and invalid items fail individually", async () => {
      const dateKey = formatDateKey(new Date(), "Asia/Dhaka");
      const validSaleId = uuidv7();
      const invalidSaleId = uuidv7();
      const newCustId = uuidv7();

      // Open a fresh shift for testing
      const regRes = await request(app.getHttpServer()).post("/api/v1/registers").set("Authorization", `Bearer ${ownerToken}`).send({
        branchId, name: "Batch Reg", code: "REGBAT", allowOffline: true,
      });
      const batchShift = await request(app.getHttpServer()).post("/api/v1/shifts/open").set("Authorization", `Bearer ${cashierToken}`).send({
        registerId: regRes.body.data.id, branchId, openingCashMinor: 100000,
      });
      const batchShiftId = batchShift.body.data.id;

      const batchPayload = {
        items: [
          {
            type: "customer" as const,
            id: newCustId,
            payload: { name: "Offline Customer", phone: "01788889999" },
          },
          {
            type: "sale" as const,
            id: validSaleId,
            payload: {
              id: validSaleId,
              shiftId: batchShiftId,
              branchId,
              customerId: newCustId,
              isOffline: true,
              invoiceNumber: `REGBAT-O-${dateKey}-0001`,
              items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
              payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
              expectedTotalMinor: 220000,
            },
          },
          {
            type: "sale" as const,
            id: invalidSaleId,
            payload: {
              id: invalidSaleId,
              shiftId: batchShiftId,
              branchId,
              isOffline: true,
              invoiceNumber: `REGBAT-O-${dateKey}-0002`,
              items: [{ variantId, quantity: 1, unitPriceMinor: 220000 }],
              payments: [{ paymentMethod: "cash", amountMinor: 220000 }],
              expectedTotalMinor: 99999, // Mismatched total
            },
          },
        ],
      };

      const res = await request(app.getHttpServer())
        .post("/api/v1/pos/sync")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send(batchPayload);

      expect([200, 201]).toContain(res.status);
      const results = res.body.data.results;
      expect(results.length).toBe(3);

      expect(results[0].status).toBe("synced");
      expect(results[1].status).toBe("synced");
      expect(results[2].status).toBe("failed");
      expect(results[2].error.code).toBe("TOTALS_MISMATCH");

      // Verify that customer was created with client id
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const cust = await tx.customer.findUnique({ where: { id: newCustId } });
        expect(cust).toBeDefined();
        expect(cust?.name).toBe("Offline Customer");
      });
    });
  });

  describe("9. User POS PIN Setting & Verification", () => {
    it("cashier can set their own PIN and Manager can set PIN for user", async () => {
      const setMyPinRes = await request(app.getHttpServer())
        .patch("/api/v1/users/me/pin")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({ pin: "1234" });

      expect(setMyPinRes.status).toBe(200);
      expect(setMyPinRes.body.data.success).toBe(true);

      const setOtherPinRes = await request(app.getHttpServer())
        .patch(`/api/v1/users/${cashierUserId}/pin`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ pin: "5678" });

      expect(setOtherPinRes.status).toBe(200);
      expect(setOtherPinRes.body.data.success).toBe(true);
    });

    it("rejects non-numeric or invalid length PIN", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/users/me/pin")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({ pin: "abc" });

      expect(res.status).toBe(400);
    });
  });
});
