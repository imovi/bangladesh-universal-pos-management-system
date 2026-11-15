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
import { truncateTestDatabase } from "./test-db-helper.js";

describe("M2: Fashion Catalog with Variants, Barcodes, and RLS", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;

  let ownerTokenA: string;
  let cashierTokenA: string;
  let ownerTokenB: string;
  let tenantAId: string;
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

    // 1. Provision Tenant A (Aarong Fashion)
    const signupA = await tenantsService.signup({
      companyName: "Aarong Fashion",
      slug: "aarong-fashion",
      businessType: "fashion",
      owner: {
        name: "Aarong Owner",
        email: "owner@aarong.com",
        phone: "+8801700000001",
        password: "Password123!",
      },
      branch: {
        name: "Dhanmondi Outlet",
        code: "DHN-01",
      },
    });
    tenantAId = signupA.tenantId;

    const loginA = await authService.login({
      tenantSlug: "aarong-fashion",
      email: "owner@aarong.com",
      password: "Password123!",
    });
    ownerTokenA = loginA.accessToken;

    // Create Cashier in Tenant A
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Aarong Cashier",
        email: "cashier@aarong.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const loginCashier = await authService.login({
      tenantSlug: "aarong-fashion",
      email: "cashier@aarong.com",
      password: "Password123!",
    });
    cashierTokenA = loginCashier.accessToken;

    // 2. Provision Tenant B (Yellow Clothing)
    const signupB = await tenantsService.signup({
      companyName: "Yellow Clothing",
      slug: "yellow-clothing",
      businessType: "fashion",
      owner: {
        name: "Yellow Owner",
        email: "owner@yellow.com",
        phone: "+8801700000002",
        password: "Password123!",
      },
      branch: {
        name: "Gulshan Branch",
        code: "GLS-01",
      },
    });
    tenantBId = signupB.tenantId;

    const loginB = await authService.login({
      tenantSlug: "yellow-clothing",
      email: "owner@yellow.com",
      password: "Password123!",
    });
    ownerTokenB = loginB.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("creates category, brand, collection, and tax_class", async () => {
    const catRes = await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ name: "Menswear" });
    expect(catRes.status).toBe(201);
    expect(catRes.body.data.name).toBe("Menswear");

    const brandRes = await request(app.getHttpServer())
      .post("/api/v1/brands")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ name: "Taaga" });
    expect(brandRes.status).toBe(201);

    const collectionRes = await request(app.getHttpServer())
      .post("/api/v1/collections")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ name: "Eid 2027" });
    expect(collectionRes.status).toBe(201);

    const taxRes = await request(app.getHttpServer())
      .post("/api/v1/tax-classes")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ name: "Standard VAT", rateBp: 750, isDefault: true });
    expect(taxRes.status).toBe(201);
    expect(taxRes.body.data.rateBp).toBe(750);
  });

  it("POST /products with 3 sizes × 4 colours creates 12 variants with unique SKUs in one transaction", async () => {
    const payload = {
      name: "Silk Panjabi",
      sku: "PANJABI",
      priceMinor: 350000, // 3,500.00 BDT
      costMinor: 200000,  // 2,000.00 BDT
      reorderLevel: 5,
      options: [
        { name: "Size", values: ["S", "M", "L"] },
        { name: "Colour", values: ["White", "Black", "Navy", "Maroon"] },
      ],
    };

    const res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    const product = res.body.data;
    expect(product.name).toBe("Silk Panjabi");
    expect(product.options).toHaveLength(2);
    expect(product.variants).toHaveLength(12); // 3 sizes × 4 colours = 12

    // Verify all 12 SKUs are unique
    const skus = product.variants.map((v: any) => v.sku);
    const uniqueSkus = new Set(skus);
    expect(uniqueSkus.size).toBe(12);

    // Verify options are assigned to each variant
    for (const v of product.variants) {
      expect(v.priceMinor).toBe(350000);
      expect(v.costMinor).toBe(200000);
      expect(v.optionValues).toHaveLength(2);
    }
  });

  it("POST /products with no options creates exactly one default variant", async () => {
    const payload = {
      name: "Single Cotton Mask",
      sku: "MASK-01",
      priceMinor: 10000,
      costMinor: 4000,
      options: [],
    };

    const res = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send(payload);

    expect(res.status).toBe(201);
    const product = res.body.data;
    expect(product.variants).toHaveLength(1);
    expect(product.variants[0].sku).toBe("MASK-01");
  });

  it("GET /variants/lookup?code= resolves variant by barcode and by SKU", async () => {
    // 1. Fetch created product
    const productsRes = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const product = productsRes.body.data[0];
    const targetVariant = product.variants[0];

    // 2. Add custom barcode
    const barcodeRes = await request(app.getHttpServer())
      .post(`/api/v1/variants/${targetVariant.id}/barcodes`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ barcode: "8941234567890" });
    expect(barcodeRes.status).toBe(201);

    // 3. Lookup by SKU
    const lookupSku = await request(app.getHttpServer())
      .get(`/api/v1/variants/lookup?code=${encodeURIComponent(targetVariant.sku)}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);
    expect(lookupSku.status).toBe(200);
    expect(lookupSku.body.data.id).toBe(targetVariant.id);
    expect(lookupSku.body.data.productName).toBe(product.name);

    // 4. Lookup by Barcode
    const lookupBarcode = await request(app.getHttpServer())
      .get("/api/v1/variants/lookup?code=8941234567890")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    expect(lookupBarcode.status).toBe(200);
    expect(lookupBarcode.body.data.id).toBe(targetVariant.id);
  });

  it("duplicate barcode in a tenant is rejected; same barcode in another tenant is allowed", async () => {
    // Lookup multi-variant product in Tenant A
    const productsRes = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const prodA = productsRes.body.data.find((p: any) => p.variants && p.variants.length > 1);

    // Try adding duplicate barcode in Tenant A -> 409 Conflict
    const dupRes = await request(app.getHttpServer())
      .post(`/api/v1/variants/${prodA.variants[1].id}/barcodes`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ barcode: "8941234567890" });
    expect(dupRes.status).toBe(409);

    // Now in Tenant B: create a product and use the same barcode "8941234567890" -> allowed!
    const createB = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenB}`)
      .send({
        name: "Yellow Polo",
        sku: "POLO-B",
        priceMinor: 150000,
        options: [],
      });
    expect(createB.status).toBe(201);
    const variantB = createB.body.data.variants[0];

    const barcodeB = await request(app.getHttpServer())
      .post(`/api/v1/variants/${variantB.id}/barcodes`)
      .set("Authorization", `Bearer ${ownerTokenB}`)
      .send({ barcode: "8941234567890" });
    expect(barcodeB.status).toBe(201);
    expect(barcodeB.body.data.barcode).toBe("8941234567890");
  });

  it("cashier role CANNOT see cost_minor in any response (field-level check)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${cashierTokenA}`);

    expect(res.status).toBe(200);
    const products = res.body.data;
    expect(products.length).toBeGreaterThan(0);

    for (const p of products) {
      for (const v of p.variants) {
        expect(v.costMinor).toBeUndefined();
      }
    }

    // Also on single variant lookup
    const lookupRes = await request(app.getHttpServer())
      .get("/api/v1/variants/lookup?code=8941234567890")
      .set("Authorization", `Bearer ${cashierTokenA}`);
    expect(lookupRes.status).toBe(200);
    expect(lookupRes.body.data.costMinor).toBeUndefined();
  });

  it("bulk price update modifies variant prices and writes audit log before/after", async () => {
    const prodRes = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const product = prodRes.body.data.find((p: any) => p.variants && p.variants.length > 1);
    const v1 = product.variants[0];
    const v2 = product.variants[1];

    const bulkRes = await request(app.getHttpServer())
      .patch(`/api/v1/products/${product.id}/variants/bulk-price`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        variants: [
          { variantId: v1.id, priceMinor: 420000 },
          { variantId: v2.id, priceMinor: 430000 },
        ],
      });

    expect(bulkRes.status).toBe(200);

    // Check audit logs
    const auditRes = await request(app.getHttpServer())
      .get("/api/v1/audit-logs?entityType=ProductVariant")
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(auditRes.status).toBe(200);
    const logs = auditRes.body.data;
    const priceChangeLogs = logs.filter((l: any) => l.action === "variant.price_update");
    expect(priceChangeLogs.length).toBeGreaterThanOrEqual(2);
    expect(priceChangeLogs[0].before.priceMinor).toBeDefined();
    expect(priceChangeLogs[0].after.priceMinor).toBeDefined();
  });

  it("product search by name or SKU supports pagination", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/products?search=Panjabi&page=1&limit=5")
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.pagination).toBeDefined();
    expect(res.body.meta.pagination.page).toBe(1);
    expect(res.body.meta.pagination.limit).toBe(5);
  });

  it("lists categories, brands, collections, tax classes and retrieves/updates single product", async () => {
    const [cats, brands, colls, taxes] = await Promise.all([
      request(app.getHttpServer()).get("/api/v1/categories").set("Authorization", `Bearer ${ownerTokenA}`),
      request(app.getHttpServer()).get("/api/v1/brands").set("Authorization", `Bearer ${ownerTokenA}`),
      request(app.getHttpServer()).get("/api/v1/collections").set("Authorization", `Bearer ${ownerTokenA}`),
      request(app.getHttpServer()).get("/api/v1/tax-classes").set("Authorization", `Bearer ${ownerTokenA}`),
    ]);

    expect(cats.status).toBe(200);
    expect(brands.status).toBe(200);
    expect(colls.status).toBe(200);
    expect(taxes.status).toBe(200);

    const productsRes = await request(app.getHttpServer())
      .get("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const prodId = productsRes.body.data[0].id;

    // GET /products/:id
    const singleRes = await request(app.getHttpServer())
      .get(`/api/v1/products/${prodId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);
    expect(singleRes.status).toBe(200);
    expect(singleRes.body.data.id).toBe(prodId);

    // PATCH /products/:id
    const patchRes = await request(app.getHttpServer())
      .patch(`/api/v1/products/${prodId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({ description: "Updated premium description" });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.description).toBe("Updated premium description");
  });
});
