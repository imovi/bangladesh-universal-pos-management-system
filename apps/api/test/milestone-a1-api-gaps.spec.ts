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

describe("Milestone A1 — API Gaps for Admin Dashboard", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;

  let ownerToken: string;
  let managerToken: string;
  let tenantId: string;
  let branchId: string;
  let testVariantId: string;

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

    // Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Fashion Outlet A",
      slug: "fashion-a",
      businessType: "fashion",
      owner: {
        name: "Owner A",
        email: "owner-a@example.com",
        phone: "+8801700000001",
        password: "Password123!",
      },
      branch: { name: "Branch A", code: "BR-A" },
    });
    tenantId = signupA.tenantId;
    branchId = signupA.branchId;

    const loginOwnerA = await authService.login({
      tenantSlug: "fashion-a",
      email: "owner-a@example.com",
      password: "Password123!",
    });
    ownerToken = loginOwnerA.accessToken;

    // Create Manager user in Tenant A
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const managerRole = rolesRes.body.data.find((r: any) => r.name === "Manager");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Manager A",
        email: "manager-a@example.com",
        password: "Password123!",
        roleIds: [managerRole.id],
        branchIds: [branchId],
      });

    const loginMgrA = await authService.login({
      tenantSlug: "fashion-a",
      email: "manager-a@example.com",
      password: "Password123!",
    });
    managerToken = loginMgrA.accessToken;

    // Tenant B (for tenant isolation tests)
    const signupB = await tenantsService.signup({
      companyName: "Fashion Outlet B",
      slug: "fashion-b",
      businessType: "fashion",
      owner: {
        name: "Owner B",
        email: "owner-b@example.com",
        phone: "+8801700000002",
        password: "Password123!",
      },
      branch: { name: "Branch B", code: "BR-B" },
    });
    tenantBId = signupB.tenantId;

    const loginOwnerB = await authService.login({
      tenantSlug: "fashion-b",
      email: "owner-b@example.com",
      password: "Password123!",
    });
    tenantBToken = loginOwnerB.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe("1. Shop Settings Endpoints", () => {
    it("GET /settings returns tenant settings and name; Manager has read permission", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/settings")
        .set("Authorization", `Bearer ${managerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Fashion Outlet A");
      expect(res.body.data.settings.currency).toBe("BDT");
      expect(res.body.data.settings.timezone).toBe("Asia/Dhaka");
    });

    it("PATCH /settings fails for Manager (403 Forbidden)", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${managerToken}`)
        .send({ name: "Hacked Outlet" });

      expect(res.status).toBe(403);
    });

    it("PATCH /settings updates name and settings with strict validation", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Updated Fashion Outlet",
          receipt_header: "Welcome to Fashion Outlet!",
          receipt_footer: "Thank you for shopping with us!",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Fashion Outlet");
      expect(res.body.data.settings.receipt_header).toBe("Welcome to Fashion Outlet!");
    });

    it("PATCH /settings rejects unknown keys with 400 (strict schema)", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          unknownField: "malicious",
        });

      expect(res.status).toBe(400);
    });

    it("PATCH /settings rejects invalid IANA timezone with 400", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          timezone: "Invalid/Fake_Zone",
        });

      expect(res.status).toBe(400);
    });
  });

  describe("2. Categories Hierarchy & Uniqueness", () => {
    let catAId: string;
    let catBId: string;

    it("creates categories and tests GET /categories/:id", async () => {
      const resA = await request(app.getHttpServer())
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Men" });
      expect(resA.status).toBe(201);
      catAId = resA.body.data.id;

      const resB = await request(app.getHttpServer())
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Shirts", parentId: catAId });
      expect(resB.status).toBe(201);
      catBId = resB.body.data.id;

      const getRes = await request(app.getHttpServer())
        .get(`/api/v1/categories/${catBId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.data.name).toBe("Shirts");
      expect(getRes.body.data.parentId).toBe(catAId);
      expect(getRes.body.data.isActive).toBe(true);
    });

    it("PATCH /categories/:id rejects self-parent with 422", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${catAId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ parentCategoryId: catAId });

      expect(res.status).toBe(422);
    });

    it("PATCH /categories/:id rejects circular descendant parent with 422", async () => {
      // catA is parent of catB. Making catA's parent = catB creates circular reference
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${catAId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ parentCategoryId: catBId });

      expect(res.status).toBe(422);
    });

    it("PATCH /categories/:id rejects duplicate name with 409", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${catBId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Men" }); // Name "Men" already taken by catA

      expect(res.status).toBe(409);
    });
  });

  describe("3. Tax Classes Single Default & Immutability", () => {
    let taxAId: string;
    let taxBId: string;

    it("creates tax classes and ensures setting isDefault clears previous default in same tx", async () => {
      const resA = await request(app.getHttpServer())
        .post("/api/v1/tax-classes")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "VAT 5%", rateBp: 500, isDefault: true });
      expect(resA.status).toBe(201);
      taxAId = resA.body.data.id;

      const resB = await request(app.getHttpServer())
        .post("/api/v1/tax-classes")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "VAT 7.5%", rateBp: 750, isDefault: false });
      expect(resB.status).toBe(201);
      taxBId = resB.body.data.id;

      // Update taxB to isDefault: true
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/tax-classes/${taxBId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ isDefault: true });
      expect(patchRes.status).toBe(200);

      // Verify taxA is no longer default
      const getA = await request(app.getHttpServer())
        .get(`/api/v1/tax-classes/${taxAId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(getA.body.data.isDefault).toBe(false);

      const getB = await request(app.getHttpServer())
        .get(`/api/v1/tax-classes/${taxBId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(getB.body.data.isDefault).toBe(true);
    });

    it("PATCH /tax-classes/:id rejects deactivating default tax class with 409", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/tax-classes/${taxBId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(409);
    });
  });

  describe("4. Variant Update & Barcode Removal", () => {
    let variantId: string;
    let barcodeId: string;

    it("creates product and tests variant PATCH and barcode deletion", async () => {
      const prodRes = await request(app.getHttpServer())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Test Shirt",
          sku: "TEST-SHIRT-A1",
          priceMinor: 100000,
          costMinor: 50000,
        });
      expect(prodRes.status).toBe(201);
      variantId = prodRes.body.data.variants[0].id;
      testVariantId = variantId;

      // Add barcode
      const barRes = await request(app.getHttpServer())
        .post(`/api/v1/variants/${variantId}/barcodes`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ barcode: "8901234567890" });
      expect(barRes.status).toBe(201);
      barcodeId = barRes.body.data.id;

      // Update variant
      const updateRes = await request(app.getHttpServer())
        .patch(`/api/v1/variants/${variantId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ priceMinor: 120000, reorderLevel: 5 });
      expect(updateRes.status).toBe(200);
      expect(Number(updateRes.body.data.priceMinor)).toBe(120000);

      // Delete barcode
      const delRes = await request(app.getHttpServer())
        .delete(`/api/v1/variants/${variantId}/barcodes/${barcodeId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(delRes.status).toBe(200);

      // Verify barcode is deleted
      const checkRes = await request(app.getHttpServer())
        .delete(`/api/v1/variants/${variantId}/barcodes/${barcodeId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(checkRes.status).toBe(404);
    });
  });

  describe("5. Tenant Isolation", () => {
    it("Tenant B cannot read or patch Tenant A's settings, categories or variants (404 Not Found)", async () => {
      // Read settings of Tenant A using Tenant B token -> returns Tenant B's own settings, not A
      const bSettings = await request(app.getHttpServer())
        .get("/api/v1/settings")
        .set("Authorization", `Bearer ${tenantBToken}`);
      expect(bSettings.body.data.name).toBe("Fashion Outlet B");

      // Attempt to patch category of Tenant A using Tenant B token -> 404
      const catList = await request(app.getHttpServer())
        .get("/api/v1/categories")
        .set("Authorization", `Bearer ${ownerToken}`);
      const catA = catList.body.data[0];

      const patchOther = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${catA.id}`)
        .set("Authorization", `Bearer ${tenantBToken}`)
        .send({ name: "Cross Tenant Attack" });
      expect(patchOther.status).toBe(404);

      // Attempt to delete variant barcode across tenants -> 404
      const crossDel = await request(app.getHttpServer())
        .delete(`/api/v1/variants/${testVariantId}/barcodes/00000000-0000-0000-0000-000000000000`)
        .set("Authorization", `Bearer ${tenantBToken}`);
      expect(crossDel.status).toBe(404);
    });

    it("PATCH /categories/:id rejects parent category from another tenant with 422", async () => {
      // Create category in Tenant B
      const resB = await request(app.getHttpServer())
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${tenantBToken}`)
        .send({ name: "Tenant B Category" });
      const catBId = resB.body.data.id;

      // Create category in Tenant A
      const resA = await request(app.getHttpServer())
        .post("/api/v1/categories")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "Tenant A Category" });
      const catAId = resA.body.data.id;

      // Attempt to set Tenant A category's parent to Tenant B category
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/categories/${catAId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ parentCategoryId: catBId });
      expect(patchRes.status).toBe(422);
    });
  });

  describe("6. Supplier Balance & Statement with Opening Balance Carry-Forward", () => {
    let supplierId: string;
    let variantId: string;

    it("records goods receipts and payments, verifying statement running balance and carry-forward", async () => {
      // 1. Create Supplier
      const supRes = await request(app.getHttpServer())
        .post("/api/v1/suppliers")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Fabrics Wholesale BD",
          contactName: "Rahim",
          phone: "+8801800000001",
        });
      expect(supRes.status).toBe(201);
      supplierId = supRes.body.data.id;

      // 2. Create Product Variant
      const prodRes = await request(app.getHttpServer())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Cotton Roll",
          sku: "COTTON-ROLL",
          priceMinor: 50000,
          costMinor: 20000,
        });
      variantId = prodRes.body.data.variants[0].id;

      // 3. Goods Receipt 1 on 2026-01-01: 10 units @ 20,000 = 200,000 minor
      const grn1Res = await request(app.getHttpServer())
        .post("/api/v1/goods-receipts")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          supplierId,
          branchId,
          receivedAt: new Date("2026-01-01T10:00:00Z").toISOString(),
          items: [{ variantId, qtyReceived: 10, unitCostMinor: 20000 }],
        });
      expect(grn1Res.status).toBe(201);

      // 4. Payment 1 on 2026-01-05: 50,000 minor
      const pay1Res = await request(app.getHttpServer())
        .post("/api/v1/supplier-payments")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          supplierId,
          amountMinor: 50000,
          paymentMethod: "bank_transfer",
          paidAt: new Date("2026-01-05T10:00:00Z").toISOString(),
        });
      expect(pay1Res.status).toBe(201);

      // 5. Goods Receipt 2 on 2026-02-01: 5 units @ 20,000 = 100,000 minor
      const grn2Res = await request(app.getHttpServer())
        .post("/api/v1/goods-receipts")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          supplierId,
          branchId,
          receivedAt: new Date("2026-02-01T10:00:00Z").toISOString(),
          items: [{ variantId, qtyReceived: 5, unitCostMinor: 20000 }],
        });
      expect(grn2Res.status).toBe(201);

      // 6. Check GET /suppliers/:id/balance
      // Total received: 200,000 + 100,000 = 300,000
      // Total paid: 50,000
      // Balance: 250,000
      const balRes = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierId}/balance`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(balRes.status).toBe(200);
      expect(balRes.body.data.totalReceivedMinor).toBe(300000);
      expect(balRes.body.data.totalPaidMinor).toBe(50000);
      expect(balRes.body.data.currentBalanceMinor).toBe(250000);

      // 7. Statement with pagination (limit: 1, page: 2) proves carry-forward
      const stmtPage2 = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierId}/statement?page=2&limit=1`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(stmtPage2.status).toBe(200);
      expect(stmtPage2.body.data.meta.page).toBe(2);
      expect(stmtPage2.body.data.openingBalanceMinor).toBe(200000); // Carried forward from GRN 1

      // 8. Full Statement: last transaction running balance equals balance endpoint
      const fullStmt = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierId}/statement`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(fullStmt.status).toBe(200);
      expect(fullStmt.body.data.closingBalanceMinor).toBe(balRes.body.data.currentBalanceMinor);
    });
  });

  describe("7. Goods Receipts List Filtering", () => {
    it("GET /goods-receipts filters by supplierId, branchId, and returns paginated result", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/goods-receipts?branchId=${branchId}&page=1&limit=10`)
        .set("Authorization", `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.meta).toBeDefined();
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });
  });

  describe("8. Tax Class Rate Change Immutability & Currency Change Protection", () => {
    let registerId: string;
    let shiftId: string;
    let taxClassId: string;
    let taxableVariantId: string;

    it("creates register, opens shift, posts sale, and verifies tax rate change does not alter existing sale", async () => {
      // 1. Create tax class with 10% VAT
      const taxRes = await request(app.getHttpServer())
        .post("/api/v1/tax-classes")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ name: "VAT 10%", rateBp: 1000, isDefault: false });
      taxClassId = taxRes.body.data.id;

      // 2. Create product with that tax class
      const prodRes = await request(app.getHttpServer())
        .post("/api/v1/products")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          name: "Luxury Panjabi",
          sku: "LUX-PANJABI",
          taxClassId,
          priceMinor: 100000,
        });
      taxableVariantId = prodRes.body.data.variants[0].id;

      // Add stock for the variant
      await request(app.getHttpServer())
        .post("/api/v1/inventory/opening-stock")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({
          branchId,
          items: [{ variantId: taxableVariantId, quantity: 10, unitCostMinor: 50000 }],
        });

      // Update tenant setting prices_include_tax = false so 100,000 + 10% tax = 110,000
      await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ prices_include_tax: false });

      // 3. Create register and open shift
      const regRes = await request(app.getHttpServer())
        .post("/api/v1/registers")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, name: "Reg 1", code: "REG-01" });
      registerId = regRes.body.data.id;

      const shiftRes = await request(app.getHttpServer())
        .post("/api/v1/shifts/open")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ branchId, registerId, openingCashMinor: 50000 });
      shiftId = shiftRes.body.data.id;

      // 4. Post sale with 10% tax: price 100,000 + 10,000 tax = 110,000
      const saleId = uuidv7();
      const saleRes = await request(app.getHttpServer())
        .post("/api/v1/sales")
        .set("Authorization", `Bearer ${ownerToken}`)
        .set("Idempotency-Key", saleId)
        .send({
          id: saleId,
          branchId,
          shiftId,
          items: [{ variantId: taxableVariantId, quantity: 1 }],
          payments: [{ paymentMethod: "cash", amountMinor: 110000 }],
          expectedTotalMinor: 110000,
        });
      expect(saleRes.status).toBe(201);
      const originalTax = Number(saleRes.body.data.taxMinor);
      expect(originalTax).toBe(10000);

      // 5. Change tax class rate to 15% (1500 bp)
      const patchTaxRes = await request(app.getHttpServer())
        .patch(`/api/v1/tax-classes/${taxClassId}`)
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ rateBp: 1500 });
      expect(patchTaxRes.status).toBe(200);

      // 6. Verify existing sale's stored tax is unchanged
      const checkSaleRes = await request(app.getHttpServer())
        .get(`/api/v1/sales/${saleId}`)
        .set("Authorization", `Bearer ${ownerToken}`);
      expect(Number(checkSaleRes.body.data.taxMinor)).toBe(originalTax);

      // 7. Verify currency cannot be changed once tenant has a sale (409 Conflict)
      const changeCurrRes = await request(app.getHttpServer())
        .patch("/api/v1/settings")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ currency: "USD" });
      expect(changeCurrRes.status).toBe(409);
    });
  });
});
