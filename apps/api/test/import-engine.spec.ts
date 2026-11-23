import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { json, urlencoded } from "express";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";
import { PrismaClient } from "@prisma/client";

describe("Milestone F4: Data Import Engine & API Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let branchCode: string;
  let tenantBToken: string;
  let tenantBId: string;

  beforeAll(async () => {
    await truncateTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.use(json({ limit: "50mb" }));
    app.use(urlencoded({ limit: "50mb", extended: true }));
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    tenantContext = app.get(TenantContextService);

    // Setup Tenant A (Owner & Cashier) with unique randomized slug
    const runSuffix = Math.random().toString(36).substring(2, 8);
    const slugA = `import-fashion-${runSuffix}`;
    const emailA = `owner-${runSuffix}@importfashion.com`;
    const cashierEmail = `cashier-${runSuffix}@importfashion.com`;
    const slugB = `other-boutique-${runSuffix}`;
    const emailB = `owner-${runSuffix}@otherboutique.com`;

    const signupA = await tenantsService.signup({
      companyName: "Import Fashion Ltd",
      slug: slugA,
      businessType: "fashion",
      owner: {
        name: "Import Owner",
        email: emailA,
        phone: `+88017${Math.floor(10000000 + Math.random() * 90000000)}`,
        password: "Password123!",
      },
      branch: { name: "Gulshan Flagship", code: "GUL-01" },
    });
    tenantId = signupA.tenantId;
    branchId = signupA.branchId;
    branchCode = "GUL-01";

    const loginOwner = await authService.login({
      tenantSlug: slugA,
      email: emailA,
      password: "Password123!",
    });
    ownerToken = loginOwner.accessToken;

    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Floor Cashier",
        email: cashierEmail,
        password: "Password123!",
        roleIds: [cashierRole.id],
        branchIds: [branchId],
      });

    const loginCashier = await authService.login({
      tenantSlug: slugA,
      email: cashierEmail,
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;

    // Setup Tenant B (for cross-tenant isolation)
    const signupB = await tenantsService.signup({
      companyName: "Other Boutique Ltd",
      slug: slugB,
      businessType: "fashion",
      owner: {
        name: "Other Owner",
        email: emailB,
        phone: `+88017${Math.floor(10000000 + Math.random() * 90000000)}`,
        password: "Password123!",
      },
      branch: { name: "Uttara Branch", code: "UTT-01" },
    });
    tenantBId = signupB.tenantId;

    const loginB = await authService.login({
      tenantSlug: slugB,
      email: emailB,
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;
  });

  afterAll(async () => {
    try {
      const tenantIdsToDelete = [tenantId, tenantBId].filter(Boolean);
      if (tenantIdsToDelete.length > 0) {
        const systemPrisma = new PrismaClient({
          datasources: {
            db: {
              url:
                process.env.MIGRATION_TEST_DATABASE_URL ||
                process.env.MIGRATION_DATABASE_URL ||
                "postgresql://pos_admin:pos_secret@localhost:5432/universal_pos_test?schema=public",
            },
          },
        });
        await systemPrisma.tenant.deleteMany({
          where: { id: { in: tenantIdsToDelete } },
        });
        await systemPrisma.$disconnect();
      }
    } catch (err) {
      console.warn("Failed to clean up test tenants in afterAll:", err);
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe("Permission & Access Control", () => {
    it("refuses import preview and commit for Cashier without data.import (403)", async () => {
      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          type: "products",
          csvText: "product_name,category,sku\nTest,Cat,SKU1",
        });
      expect(previewRes.status).toBe(403);

      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${cashierToken}`)
        .send({
          type: "products",
          csvText: "product_name,category,sku\nTest,Cat,SKU1",
        });
      expect(commitRes.status).toBe(403);
    });

    it("allows Owner to download templates with UTF-8 BOM", async () => {
      for (const type of ["products", "stock", "customers"]) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/import/templates/${type}`)
          .set("Authorization", `Bearer ${ownerToken}`);

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/csv");
        expect(res.headers["content-disposition"]).toContain(`${type}-template.csv`);
        expect(res.text.startsWith("\uFEFF")).toBe(true);
        expect(res.text.length).toBeGreaterThan(20);
      }
    });
  });

  describe("Product Import (Preview, Errors, Commit, Repeat)", () => {
    it("reports errors on invalid rows and refuses commit when errors exist", async () => {
      const badCsv =
        "product_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate\n" +
        ",পাঞ্জাবি,আড়ং,ঈদ,L,সাদা,PUN-BAD1,,2500,1600,7.5\n" + // missing name
        "পাঞ্জাবি,,আড়ং,ঈদ,L,সাদা,PUN-BAD2,,2500,1600,7.5\n" + // missing category
        "পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ,L,সাদা,,,2500,1600,7.5\n" + // missing sku
        "পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ,L,সাদা,PUN-BAD3,,-100,1600,7.5\n"; // negative price

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: badCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.totalRows).toBe(4);
      expect(previewRes.body.data.errorRows).toBe(4);
      expect(previewRes.body.data.validRows).toBe(0);

      // Attempt commit - must be refused
      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: badCsv });

      expect(commitRes.status).toBe(400);
      const msg = commitRes.body.error?.message || commitRes.body.message || "";
      expect(msg).toContain("ত্রুটি রয়েছে");
    });

    it("previews and commits valid products grouping variants by name with UTF-8 BOM and Bangla text", async () => {
      const validCsv =
        '\uFEFFproduct_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate\r\n' +
        'প্রিমিয়াম সিল্ক পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ কালেকশন ২০২৬,L,সাদা,SILK-L-WHT,890123450001,"3,200.00","1,800",7.5\r\n' +
        'প্রিমিয়াম সিল্ক পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ কালেকশন ২০২৬,XL,সাদা,SILK-XL-WHT,890123450002,"3,400.00","1,900",7.5\r\n' +
        'জামদানি শাড়ি,শাড়ি,ঐতিহ্য,উৎসব,Free,নীল,JAM-FREE-BLU,890123450003,"7,500","4,200",7.5\r\n';

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: validCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.totalRows).toBe(3);
      expect(previewRes.body.data.errorRows).toBe(0);
      expect(previewRes.body.data.validRows).toBe(3);

      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: validCsv });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.data.importedCount).toBe(3);

      // Verify product grouping in database
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const product = await tx.product.findFirst({
          where: { tenantId, name: "প্রিমিয়াম সিল্ক পাঞ্জাবি" },
          include: { variants: true, category: true, brand: true, collection: true },
        });
        expect(product).toBeTruthy();
        expect(product!.variants.length).toBe(2);
        expect(product!.category?.name).toBe("পাঞ্জাবি");
        expect(product!.brand?.name).toBe("আড়ং");
        expect(product!.collection?.name).toBe("ঈদ কালেকশন ২০২৬");

        const varL = product!.variants.find((v) => v.sku === "SILK-L-WHT");
        expect(varL).toBeTruthy();
        expect(Number(varL!.priceMinor)).toBe(320000); // 3,200.00 -> 320,000 poisha
        expect(Number(varL!.costMinor)).toBe(180000); // 1,800 -> 180,000 poisha
      });
    });

    it("safe to repeat: re-importing same product file updates existing variants and does not duplicate", async () => {
      const updateCsv =
        'product_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate\n' +
        'প্রিমিয়াম সিল্ক পাঞ্জাবি,পাঞ্জাবি,আড়ং,ঈদ কালেকশন ২০২৬,L,সাদা,SILK-L-WHT,890123450001,"3,500.00","2,000",7.5\n'; // updated price

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: updateCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.rows[0].action).toBe("UPDATE");

      await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: updateCsv });

      // Verify price updated and count remains 2
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const variants = await tx.productVariant.findMany({
          where: { tenantId, sku: "SILK-L-WHT" },
        });
        expect(variants.length).toBe(1);
        expect(Number(variants[0].priceMinor)).toBe(350000); // updated
      });
    });
  });

  describe("Opening Stock Import (Preview, Refusal on Duplicate, Movements)", () => {
    it("imports opening stock creating OPENING movements and updating stock levels", async () => {
      const stockCsv =
        `sku,branch_code,quantity,unit_cost\n` +
        `SILK-L-WHT,${branchCode},50,1800\n` +
        `SILK-XL-WHT,${branchCode},30,1900\n`;

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "stock", csvText: stockCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.errorRows).toBe(0);

      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "stock", csvText: stockCsv });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.data.importedCount).toBe(2);

      // Verify stock levels and movements
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const varL = await tx.productVariant.findFirst({
          where: { tenantId, sku: "SILK-L-WHT" },
        });
        const level = await tx.stockLevel.findUnique({
          where: {
            tenantId_branchId_variantId: {
              tenantId,
              branchId,
              variantId: varL!.id,
            },
          },
        });
        expect(level).toBeTruthy();
        expect(Number(level!.qty)).toBe(50);

        const movement = await tx.stockMovement.findFirst({
          where: {
            tenantId,
            branchId,
            variantId: varL!.id,
            type: "OPENING",
          },
        });
        expect(movement).toBeTruthy();
        expect(Number(movement!.qtyDelta)).toBe(50);
        expect(Number(movement!.unitCostMinor)).toBe(180000);
      });
    });

    it("refuses duplicate opening stock import for the same SKU and branch with a clear message", async () => {
      const duplicateStockCsv =
        `sku,branch_code,quantity,unit_cost\n` +
        `SILK-L-WHT,${branchCode},25,1800\n`;

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "stock", csvText: duplicateStockCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.errorRows).toBe(1);
      expect(previewRes.body.data.rows[0].errors[0].messageBn).toContain(
        "প্রারম্ভিক মজুদ ইতিপূর্বে যুক্ত করা হয়েছে"
      );

      // Commit must fail
      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "stock", csvText: duplicateStockCsv });

      expect(commitRes.status).toBe(400);
    });
  });

  describe("Customer Import (Phone Format, Opening Due & Points, Repeat)", () => {
    it("validates Bangladeshi phone formats and rejects invalid numbers", async () => {
      const invalidCustomerCsv =
        "name,phone,opening_due,opening_loyalty_points\n" +
        "খারাপ নম্বর,01012345678,100,0\n" + // 010 is invalid
        "ছোট নম্বর,0171122,100,0\n";

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "customers", csvText: invalidCustomerCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.errorRows).toBe(2);
      expect(previewRes.body.data.rows[0].errors[0].field).toBe("phone");
    });

    it("imports customers, creating opening balance sale for due and loyalty ADJUST entry", async () => {
      const customerCsv =
        'name,phone,opening_due,opening_loyalty_points\n' +
        'মোহাম্মদ করিম,01711000055,"৳১,৫০০",120\n' + // Quoted Bangla number formatting & poisha
        'শাহিন আলম,01811000056,0,50\n';

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "customers", csvText: customerCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.errorRows).toBe(0);
      expect(previewRes.body.data.validRows).toBe(2);

      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "customers", csvText: customerCsv });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.data.importedCount).toBe(2);

      // Verify customer record, loyalty ledger, and opening due sale
      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const cust = await tx.customer.findFirst({
          where: { tenantId, phone: "+8801711000055" },
        });
        expect(cust).toBeTruthy();
        expect(cust!.name).toBe("মোহাম্মদ করিম");
        expect(cust!.loyaltyPointsBalance).toBe(120);

        // Verify loyalty ledger ADJUST entry
        const loyaltyEntry = await tx.loyaltyLedger.findFirst({
          where: { tenantId, customerId: cust!.id, type: "ADJUST" },
        });
        expect(loyaltyEntry).toBeTruthy();
        expect(loyaltyEntry!.points).toBe(120);
        expect(loyaltyEntry!.reason).toBe("opening balance");

        // Verify opening due sale
        const openingSale = await tx.sale.findFirst({
          where: { tenantId, customerId: cust!.id, invoiceNumber: "OPENING-+8801711000055" },
        });
        expect(openingSale).toBeTruthy();
        expect(Number(openingSale!.dueMinor)).toBe(150000); // 1,500 BDT
      });
    });

    it("safe to repeat: re-importing customer with same phone updates info without duplicate customer", async () => {
      const updateCustCsv =
        "name,phone,opening_due,opening_loyalty_points\n" +
        "মোহাম্মদ করিম (আপডেটেড),01711000055,0,0\n";

      await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "customers", csvText: updateCustCsv });

      await tenantContext.runWithTenant(tenantId, async (tx) => {
        const custs = await tx.customer.findMany({
          where: { tenantId, phone: "+8801711000055" },
        });
        expect(custs.length).toBe(1);
        expect(custs[0].name).toBe("মোহাম্মদ করিম (আপডেটেড)");
      });
    });
  });

  describe("Tenant Isolation", () => {
    it("ensures imported products and customers in Tenant A are never accessible or created in Tenant B", async () => {
      // Products imported in Tenant A (SILK-L-WHT) must not exist in Tenant B
      await tenantContext.runWithTenant(tenantBId, async (tx) => {
        const variantInB = await tx.productVariant.findFirst({
          where: { tenantId: tenantBId, sku: "SILK-L-WHT" },
        });
        expect(variantInB).toBeNull();

        const custInB = await tx.customer.findFirst({
          where: { tenantId: tenantBId, phone: "+8801711000055" },
        });
        expect(custInB).toBeNull();
      });
    });
  });

  describe("Performance Check (5,000 Rows < 60s)", () => {
    it("previews and commits a 5,000-row synthetic product CSV in under 60 seconds", async () => {
      const rows: string[] = [
        "product_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate",
      ];

      for (let i = 1; i <= 5000; i++) {
        const pIndex = Math.ceil(i / 5); // 1000 products, 5 variants each
        const size = ["S", "M", "L", "XL", "XXL"][(i - 1) % 5];
        rows.push(
          `Synthetic Shirt ${pIndex},Shirts,BrandPerf,Autumn,${size},Blue,SYN-SKU-${i},${700000000000 + i},1500,900,5`
        );
      }
      const largeCsv = rows.join("\n");

      const startTime = Date.now();

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: largeCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.totalRows).toBe(5000);
      expect(previewRes.body.data.errorRows).toBe(0);

      const commitRes = await request(app.getHttpServer())
        .post("/api/v1/import/commit")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: largeCsv });

      expect(commitRes.status).toBe(200);
      expect(commitRes.body.data.importedCount).toBe(5000);

      const elapsedMs = Date.now() - startTime;
      console.log(`5,000-row synthetic CSV import completed in: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
      expect(elapsedMs).toBeLessThan(60000); // must be under 60 s
    }, 90000);

    it("previews a 20,000-row synthetic product CSV in under 30 seconds", async () => {
      const rows: string[] = [
        "product_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate",
      ];

      for (let i = 1; i <= 20000; i++) {
        const pIndex = Math.ceil(i / 5); // 4000 products, 5 variants each
        const size = ["S", "M", "L", "XL", "XXL"][(i - 1) % 5];
        rows.push(
          `Synthetic Shirt 20k ${pIndex},Shirts,BrandPerf,Autumn,${size},Blue,SYN20K-SKU-${i},${800000000000 + i},1500,900,5`
        );
      }
      const largeCsv = rows.join("\n");

      const startTime = Date.now();

      const previewRes = await request(app.getHttpServer())
        .post("/api/v1/import/preview")
        .set("Authorization", `Bearer ${ownerToken}`)
        .send({ type: "products", csvText: largeCsv });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.data.totalRows).toBe(20000);
      expect(previewRes.body.data.errorRows).toBe(0);

      const elapsedMs = Date.now() - startTime;
      console.log(`20,000-row synthetic CSV preview completed in: ${elapsedMs} ms (${(elapsedMs / 1000).toFixed(2)} s)`);
      expect(elapsedMs).toBeLessThan(30000); // must be under 30 s
    }, 45000);
  });
});
