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
import { BranchesService } from "../src/modules/branches/branches.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("Part A Data Display Tests: Products Total Stock & Stock Level Fields", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let branchesService: BranchesService;
  let inventoryService: InventoryService;

  let ownerToken: string;
  let tenantId: string;
  let branchAId: string;
  let branchBId: string;
  let productId: string;
  let variantAId: string;
  let variantBId: string;

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
    branchesService = app.get(BranchesService);
    inventoryService = app.get(InventoryService);

    // 1. Provision Tenant
    const signup = await tenantsService.signup({
      companyName: "Stock Test Apparel",
      slug: "stock-test-apparel",
      businessType: "fashion",
      owner: {
        name: "Stock Owner",
        email: "owner@stocktest.com",
        phone: "+8801700099999",
        password: "Password123!",
      },
      branch: {
        name: "Branch Alpha",
        code: "BA-01",
      },
    });
    tenantId = signup.tenantId;
    branchAId = signup.branchId;

    // Create Branch Beta
    const branchB = await branchesService.create(tenantId, {
      name: "Branch Beta",
      code: "BB-02",
    });
    branchBId = branchB.id;

    // Login Owner
    const login = await authService.login({
      tenantSlug: "stock-test-apparel",
      email: "owner@stocktest.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;

    // 2. Create Product with 2 Options (Size: M, L)
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Classic Polo Shirt",
        sku: "POLO",
        priceMinor: 100000,
        costMinor: 50000,
        reorderLevel: 10,
        options: [
          {
            name: "Size",
            values: ["M", "L"],
          },
        ],
      });
    expect(prodRes.status).toBe(201);
    productId = prodRes.body.data.id;
    variantAId = prodRes.body.data.variants[0].id;
    variantBId = prodRes.body.data.variants[1].id;

    // 3. Add stock levels:
    // Variant A on Branch Alpha: 50
    // Variant A on Branch Beta: 20
    // Variant B on Branch Alpha: 10
    // Variant B on Branch Beta: 0
    await inventoryService.createOpeningStock(tenantId, {
      branchId: branchAId,
      items: [
        { variantId: variantAId, quantity: 50, unitCostMinor: 50000 },
        { variantId: variantBId, quantity: 10, unitCostMinor: 50000 },
      ],
    });

    await inventoryService.createOpeningStock(tenantId, {
      branchId: branchBId,
      items: [
        { variantId: variantAId, quantity: 20, unitCostMinor: 50000 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /products without branchId returns totalStock equal to sum across all branches (50+20+10 = 80)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const prod = res.body.data.find((p: any) => p.id === productId);
    expect(prod).toBeDefined();
    expect(prod.totalStock).toBe(80);
  });

  it("GET /products?branchId=... returns totalStock equal to that branch's sum (Alpha: 60, Beta: 20)", async () => {
    const resAlpha = await request(app.getHttpServer())
      .get(`/api/v1/products?branchId=${branchAId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(resAlpha.status).toBe(200);
    const prodAlpha = resAlpha.body.data.find((p: any) => p.id === productId);
    expect(prodAlpha).toBeDefined();
    expect(prodAlpha.totalStock).toBe(60);

    const resBeta = await request(app.getHttpServer())
      .get(`/api/v1/products?branchId=${branchBId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(resBeta.status).toBe(200);
    const prodBeta = resBeta.body.data.find((p: any) => p.id === productId);
    expect(prodBeta).toBeDefined();
    expect(prodBeta.totalStock).toBe(20);
  });

  it("GET /inventory/levels returns branch details (name & code), variant option values, and reorderLevel", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/inventory/levels")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const items = res.body.data;
    expect(items.length).toBeGreaterThan(0);

    const itemA = items.find((i: any) => i.variantId === variantAId && i.branchId === branchAId);
    expect(itemA).toBeDefined();
    expect(itemA.branch).toBeDefined();
    expect(itemA.branch.name).toBe("Branch Alpha");
    expect(itemA.branch.code).toBe("BA-01");
    expect(itemA.reorderLevel).toBe(10);

    // Option values
    expect(itemA.variant.optionValues).toBeDefined();
    expect(itemA.variant.optionValues.length).toBeGreaterThan(0);
    expect(itemA.variant.optionValues[0].optionValue).toBeDefined();
    expect(itemA.variant.optionValues[0].optionValue.value).toBe("M");
  });
});
