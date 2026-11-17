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
import { isValidEan13 } from "@universal-pos/shared";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("Milestone C4: Barcode Generation & Parallel Uniqueness Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;

  let ownerToken: string;
  let tenantId: string;
  let categoryId: string;
  let productId: string;
  let variantIds: string[] = [];

  beforeAll(async () => {
    await truncateTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    app.setGlobalPrefix("api/v1");
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);

    // Setup Tenant
    const signup = await tenantsService.signup({
      companyName: "Barcode Test Apparel",
      slug: "barcode-test",
      businessType: "fashion",
      owner: {
        name: "Barcode Owner",
        email: "owner@barcode.com",
        phone: "+8801700000077",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB-01" },
    });
    tenantId = signup.tenantId;

    const login = await authService.login({
      tenantSlug: "barcode-test",
      email: "owner@barcode.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;

    // Create Category
    const catRes = await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "T-Shirts", slug: "t-shirts" });
    categoryId = catRes.body.data.id;

    // Create Product with 12 variants without barcodes
    const variantsPayload = [];
    for (let i = 1; i <= 12; i++) {
      variantsPayload.push({
        sku: `BC-VAR-${i}-${Date.now()}`,
        priceMinor: 120000,
        costMinor: 70000,
      });
    }

    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Barcode Test Tee",
        sku: `BC-BASE-${Date.now()}`,
        priceMinor: 120000,
        categoryId,
        variants: variantsPayload,
      });
    expect(prodRes.status).toBe(201);
    productId = prodRes.body.data.id;
    variantIds = prodRes.body.data.variants.map((v: any) => v.id);
    expect(variantIds.length).toBe(12);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("1. Generates a valid in-store EAN-13 barcode for a variant without one", async () => {
    const targetVariantId = variantIds[0];
    const res = await request(app.getHttpServer())
      .post(`/api/v1/variants/${targetVariantId}/generate-barcode`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.isNew).toBe(true);

    const barcode = res.body.data.barcode;
    expect(barcode).toHaveLength(13);
    expect(barcode.startsWith("200")).toBe(true);
    expect(isValidEan13(barcode)).toBe(true);
  });

  it("2. Existing barcodes are never changed: returns existing barcode with isNew: false", async () => {
    const targetVariantId = variantIds[0]; // Already has barcode from test 1
    const res = await request(app.getHttpServer())
      .post(`/api/v1/variants/${targetVariantId}/generate-barcode`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.isNew).toBe(false);

    // Fetch variant to confirm barcode didn't change
    const varRes = await request(app.getHttpServer())
      .get(`/api/v1/variants/${targetVariantId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(varRes.body.data.barcodes).toHaveLength(1);
    expect(varRes.body.data.barcodes[0].barcode).toBe(res.body.data.barcode);
  });

  it("3. Uniqueness under parallel generation: 10 concurrent requests generate 10 unique EAN-13 barcodes", async () => {
    const parallelVariantIds = variantIds.slice(1, 11); // 10 unbarcoded variants
    expect(parallelVariantIds.length).toBe(10);

    const promises = parallelVariantIds.map((vId) =>
      request(app.getHttpServer())
        .post(`/api/v1/variants/${vId}/generate-barcode`)
        .set("Authorization", `Bearer ${ownerToken}`),
    );

    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(201);
      expect(res.body.data.isNew).toBe(true);
      expect(isValidEan13(res.body.data.barcode)).toBe(true);
    }

    const generatedBarcodes = responses.map((r) => r.body.data.barcode);
    const uniqueSet = new Set(generatedBarcodes);
    // Every barcode must be unique under concurrent execution
    expect(uniqueSet.size).toBe(10);
  });

  it("4. Batch generation for product populates remaining unbarcoded variants", async () => {
    // variantIds[11] is still unbarcoded
    const res = await request(app.getHttpServer())
      .post(`/api/v1/variants/products/${productId}/generate-barcodes`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.productId).toBe(productId);
    expect(res.body.data.generatedCount).toBe(1); // Only the 1 remaining variant was generated
    expect(res.body.data.variants).toHaveLength(12);

    // Verify all 12 variants now have valid EAN-13 barcodes
    for (const v of res.body.data.variants) {
      expect(isValidEan13(v.barcode)).toBe(true);
    }
  });
});
