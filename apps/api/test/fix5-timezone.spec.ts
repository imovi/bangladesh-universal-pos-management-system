import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { formatDateKey, formatBusinessDate, parseDateFilterRange } from "@universal-pos/shared";

describe("Fix 5: Timezone-Aware Business Dates and Reports", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;
  let tenantId: string;
  let ownerToken: string;

  beforeAll(async () => {
    await truncateTestDatabase();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new TransformInterceptor());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    systemDb = app.get(SystemDbService);

    const signup = await tenantsService.signup({
      companyName: "Timezone Fashion",
      slug: "tz-fashion",
      businessType: "fashion",
      owner: { name: "TZ Owner", email: "owner@tzfashion.com", phone: "+8801700000051", password: "Password123!" },
      branch: { name: "Dhaka Flagship", code: "DF-01" },
    });
    tenantId = signup.tenantId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      timezone: "Asia/Dhaka",
      prices_include_tax: true,
    });

    const login = await authService.login({
      tenantSlug: "tz-fashion",
      email: "owner@tzfashion.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe("Pure Timezone Functions", () => {
    it("converts dates around midnight UTC to correct Asia/Dhaka (UTC+6) date keys", () => {
      // 2026-11-15 20:30:00 UTC is 2026-11-16 02:30:00 Asia/Dhaka
      const d1 = new Date("2026-11-15T20:30:00.000Z");
      expect(formatDateKey(d1, "Asia/Dhaka")).toBe("261116");
      expect(formatBusinessDate(d1, "Asia/Dhaka")).toBe("2026-11-16");

      // 2026-11-15 17:59:59 UTC is 2026-11-15 23:59:59 Asia/Dhaka
      const d2 = new Date("2026-11-15T17:59:59.000Z");
      expect(formatDateKey(d2, "Asia/Dhaka")).toBe("261115");
      expect(formatBusinessDate(d2, "Asia/Dhaka")).toBe("2026-11-15");

      // In UTC, d1 is 261115
      expect(formatDateKey(d1, "UTC")).toBe("261115");
    });

    it("parses calendar date filter range into exact UTC boundaries for Asia/Dhaka", () => {
      const range = parseDateFilterRange("2026-11-16", "2026-11-16", "Asia/Dhaka");
      expect(range.gte?.toISOString()).toBe("2026-11-15T18:00:00.000Z");
      expect(range.lte?.toISOString()).toBe("2026-11-16T17:59:59.999Z");
    });
  });

  describe("Integration: Invoice Number and Report Date Filtering", () => {
    it("generates invoice number with Asia/Dhaka date key and filters reports by business day", async () => {
      const branchRes = await request(app.getHttpServer())
        .post("/api/v1/branches")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: `TZ Branch ${Date.now()}`, code: `TZB-${Date.now().toString().slice(-4)}` });
      const branchId = branchRes.body.data.id;

      const regRes = await request(app.getHttpServer())
        .post("/api/v1/registers")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, name: "TZ Register", code: "TZ1" });
      const registerId = regRes.body.data.id;

      const shiftRes = await request(app.getHttpServer())
        .post("/api/v1/shifts/open")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, registerId, openingCashMinor: 100000 });
      const shiftId = shiftRes.body.data.id;

      const prodRes = await request(app.getHttpServer())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "TZ Product", sku: `TZ-SKU-${Date.now()}`, priceMinor: 50000, costMinor: 25000,
        });
      const variantId = prodRes.body.data.variants[0].id;

      await request(app.getHttpServer())
        .post("/api/v1/inventory/opening-stock")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          branchId,
          items: [{ variantId, quantity: 10, unitCostMinor: 25000 }],
        });

      const sId = uuidv7();
      const saleRes = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Idempotency-Key", sId)
        .send({
          id: sId,
          branchId,
          shiftId,
          expectedTotalMinor: 50000,
          items: [{ variantId, quantity: 1 }],
          payments: [{ paymentMethod: "cash", amountMinor: 50000 }],
        });

      expect(saleRes.status).toBe(201);
      const invoiceNumber = saleRes.body.data.invoiceNumber as string;
      const expectedDateKey = formatDateKey(new Date(), "Asia/Dhaka");
      expect(invoiceNumber).toContain(`TZ1-${expectedDateKey}-`);

      const todayDhaka = formatBusinessDate(new Date(), "Asia/Dhaka");
      const summaryRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/sales-summary?startDate=${todayDhaka}&endDate=${todayDhaka}`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(summaryRes.status).toBe(200);
      expect(summaryRes.body.data.salesCount).toBeGreaterThanOrEqual(1);

      const variantReportRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/sales-by-variant?startDate=${todayDhaka}&endDate=${todayDhaka}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(variantReportRes.status).toBe(200);
      expect(variantReportRes.body.data.length).toBeGreaterThanOrEqual(1);

      const profitReportRes = await request(app.getHttpServer())
        .get(`/api/v1/reports/profit?startDate=${todayDhaka}&endDate=${todayDhaka}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(profitReportRes.status).toBe(200);
      expect(profitReportRes.body.data.revenueMinor).toBe(50000);
    });
  });
});
