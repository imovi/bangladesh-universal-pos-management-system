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

describe("Milestone C3: Stock Transfers Engine Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let ownerToken: string;
  let cashierToken: string; // assigned to GFS-01 only
  let otherCashierToken: string; // assigned to DF-01 only
  let tenantBToken: string;

  let tenantAId: string;
  let branchAId: string; // GFS-01 (Source)
  let branchBId: string; // DF-01 (Destination)
  let variantId1: string;
  let variantId2: string;

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
    tenantContext = app.get(TenantContextService);

    // 1. Setup Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Artisan Apparel Ltd",
      slug: "artisan-apparel",
      businessType: "fashion",
      owner: {
        name: "Artisan Owner",
        email: "owner@artisan.com",
        phone: "+8801700000088",
        password: "Password123!",
      },
      branch: { name: "Gulshan Flagship Store", code: "GFS-01" },
    });
    tenantAId = signupA.tenantId;
    branchAId = signupA.branchId;

    const loginA = await authService.login({
      tenantSlug: "artisan-apparel",
      email: "owner@artisan.com",
      password: "Password123!",
    });
    ownerToken = loginA.accessToken;

    // 2. Create Destination branch DF-01
    const createBranchRes = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Dhanmondi Fashion Outlet",
        code: "DF-01",
        address: "Road 27, Dhanmondi, Dhaka",
      });
    expect(createBranchRes.status).toBe(201);
    branchBId = createBranchRes.body.data.id;
    expect(branchAId).not.toBe(branchBId);

    // 3. Create Cashiers for branch-specific receive testing
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(rolesRes.status).toBe(200);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    expect(cashierRole).toBeDefined();

    // Source Cashier (assigned to branchAId only)
    const createSrcUserRes = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: "source-cashier@artisan.com",
        password: "Password123!",
        name: "GFS Cashier",
        roleIds: [cashierRole.id],
        branchIds: [branchAId],
      });
    expect(createSrcUserRes.status).toBe(201);

    const loginSrcUser = await authService.login({
      tenantSlug: "artisan-apparel",
      email: "source-cashier@artisan.com",
      password: "Password123!",
    });
    cashierToken = loginSrcUser.accessToken;

    // Destination Cashier (assigned to branchBId only)
    const destUserEmail = `dest-cashier-${Date.now()}@artisan.com`;
    const createDestUserRes = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        email: destUserEmail,
        password: "Password123!",
        name: "DF Cashier",
        roleIds: [cashierRole.id],
        branchIds: [branchBId],
      });
    expect(createDestUserRes.status).toBe(201);

    const destLogin = await authService.login({
      tenantSlug: "artisan-apparel",
      email: destUserEmail,
      password: "Password123!",
    });
    otherCashierToken = destLogin.accessToken;

    // 4. Authenticate Tenant B (for cross-tenant checks)
    const bSlug = `tenant-b-${Date.now()}`;
    const bEmail = `owner-${Date.now()}@tenant-b.com`;
    await tenantsService.signup({
      companyName: "Tenant B Retail",
      slug: bSlug,
      businessType: "fashion",
      owner: { name: "Owner B", email: bEmail, phone: "+8801700000099", password: "Password123!" },
      branch: { name: "Branch B", code: "BRB-01" },
    });
    const loginB = await authService.login({
      tenantSlug: bSlug,
      email: bEmail,
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;

    // 5. Create a test product with variants in Tenant A
    const catRes = await request(app.getHttpServer())
      .post("/api/v1/categories")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Transfers Men Wear", slug: "transfers-men" });

    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Transfer Test Polo",
        sku: `TRF-BASE-${Date.now()}`,
        priceMinor: 85000,
        categoryId: catRes.body.data.id,
        options: [{ name: "Size", values: ["M", "L"] }],
        variants: [
          { sku: `TRF-POLO-M-${Date.now()}`, priceMinor: 85000, costMinor: 50000, optionValues: { Size: "M" } },
          { sku: `TRF-POLO-L-${Date.now()}`, priceMinor: 85000, costMinor: 50000, optionValues: { Size: "L" } },
        ],
      });
    expect(prodRes.status).toBe(201);
    variantId1 = prodRes.body.data.variants[0].id;
    variantId2 = prodRes.body.data.variants[1].id;

    // Add 100 units of stock to source branch
    await request(app.getHttpServer())
      .post("/api/v1/inventory/adjustment")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: branchAId,
        variantId: variantId1,
        qtyDelta: 100,
        reason: "C3 test seed stock",
      });

    await request(app.getHttpServer())
      .post("/api/v1/inventory/adjustment")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: branchAId,
        variantId: variantId2,
        qtyDelta: 100,
        reason: "C3 test seed stock",
      });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("1. Creates a transfer in draft status with TRF-YYMMDD-XXXX numbering", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        notes: "Test draft transfer",
        items: [
          { variantId: variantId1, quantity: 15 },
          { variantId: variantId2, quantity: 10 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe("draft");
    expect(res.body.data.transferNumber).toMatch(/^TRF-\d{6}-\d{4}$/);
    expect(res.body.data.items).toHaveLength(2);
    expect(Number(res.body.data.items[0].sentQty)).toBe(15);
  });

  it("2. Rejects transfer when source and destination branch are the same", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchAId,
        items: [{ variantId: variantId1, quantity: 5 }],
      });

    expect(res.status).toBe(400);
  });

  it("3. Can cancel only from draft status", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId1, quantity: 5 }],
      });
    const transferId = createRes.body.data.id;

    // Cancel from draft
    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Order cancelled by management" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.data.status).toBe("cancelled");

    // Cannot send cancelled transfer
    const sendRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(sendRes.status).toBe(409);
  });

  it("4. Sending moves stock out of source branch and transitions status to sent", async () => {
    // Check initial stock at source branch
    const stockBeforeRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchAId}&variantId=${variantId1}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const beforeList = Array.isArray(stockBeforeRes.body.data) ? stockBeforeRes.body.data : (stockBeforeRes.body.data?.items || []);
    const stockBefore = Number(beforeList[0]?.qty || 0);

    // Create transfer of 20 units
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId1, quantity: 20 }],
      });
    const transferId = createRes.body.data.id;

    // Send transfer
    const sendRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ notes: "Dispatched via courier" });

    expect(sendRes.status).toBe(200);
    expect(sendRes.body.data.status).toBe("sent");
    expect(sendRes.body.data.sentAt).toBeDefined();

    // Verify source stock decremented by exactly 20
    const stockAfterRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchAId}&variantId=${variantId1}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const afterList = Array.isArray(stockAfterRes.body.data) ? stockAfterRes.body.data : (stockAfterRes.body.data?.items || []);
    const stockAfter = Number(afterList[0]?.qty || 0);
    expect(stockAfter).toBe(stockBefore - 20);

    // Cannot cancel after sent
    const cancelRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/cancel`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Attempt cancel after sent" });
    expect(cancelRes.status).toBe(400);
  });

  it("5. Only users assigned to destination branch (or Owner) can receive", async () => {
    // Create and send transfer to DF-01 (branchBId)
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId1, quantity: 10 }],
      });
    const transferId = createRes.body.data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // cashierToken is assigned to GFS-01, NOT DF-01 -> expect 403 Forbidden
    const unauthReceiveRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        items: [{ variantId: variantId1, receivedQty: 10 }],
      });
    expect(unauthReceiveRes.status).toBe(403);

    // otherCashierToken is assigned to DF-01 (Destination) -> expect 200 OK
    const authReceiveRes = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${otherCashierToken}`)
      .send({
        items: [{ variantId: variantId1, receivedQty: 10 }],
      });
    expect(authReceiveRes.status).toBe(200);
    expect(authReceiveRes.body.data.status).toBe("received");
  });

  it("6. Partial receive records received stock and requires lossReason for discrepancy", async () => {
    // Stock before receive at destination
    const destStockBeforeRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchBId}&variantId=${variantId1}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const beforeDestList = Array.isArray(destStockBeforeRes.body.data) ? destStockBeforeRes.body.data : (destStockBeforeRes.body.data?.items || []);
    const destStockBefore = Number(beforeDestList[0]?.qty || 0);

    // Create & send transfer: 10 sent
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId1, quantity: 10 }],
      });
    const transferId = createRes.body.data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${ownerToken}`);

    // Missing lossReason when short (received 8 of 10) -> expect 400
    const failReceive = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${otherCashierToken}`)
      .send({
        items: [{ variantId: variantId1, receivedQty: 8 }],
      });
    expect(failReceive.status).toBe(400);

    // Providing lossReason -> expect 200 OK
    const successReceive = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${otherCashierToken}`)
      .send({
        items: [
          {
            variantId: variantId1,
            receivedQty: 8,
            lossReason: "2 pieces damaged during rain in transit",
          },
        ],
      });
    expect(successReceive.status).toBe(200);
    expect(successReceive.body.data.status).toBe("received");

    const item = successReceive.body.data.items[0];
    expect(Number(item.receivedQty)).toBe(8);
    expect(Number(item.lossQty)).toBe(2);
    expect(item.lossReason).toContain("damaged during rain");

    // Destination branch stock increased by exactly receivedQty (8)
    const destStockAfterRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchBId}&variantId=${variantId1}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    const afterDestList = Array.isArray(destStockAfterRes.body.data) ? destStockAfterRes.body.data : (destStockAfterRes.body.data?.items || []);
    const destStockAfter = Number(afterDestList[0]?.qty || 0);
    expect(destStockAfter).toBe(destStockBefore + 8);
  });

  it("7. Tracks in-transit stock quantities per destination branch", async () => {
    // Create and send a transfer with 12 units
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId2, quantity: 12 }],
      });
    const transferId = createRes.body.data.id;
    await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${ownerToken}`);

    const inTransitRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/transfers/in-transit?branchId=${branchBId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(inTransitRes.status).toBe(200);
    expect(inTransitRes.body.data[variantId2]).toBeGreaterThanOrEqual(12);
  });

  it("8. Cross-tenant isolation returns 404 for foreign transfers", async () => {
    // Tenant A creates a transfer
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/transfers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        sourceBranchId: branchAId,
        destinationBranchId: branchBId,
        items: [{ variantId: variantId1, quantity: 5 }],
      });
    const transferId = createRes.body.data.id;

    // Tenant B attempts to read
    const readB = await request(app.getHttpServer())
      .get(`/api/v1/inventory/transfers/${transferId}`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(readB.status).toBe(404);

    // Tenant B attempts to send
    const sendB = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/send`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(sendB.status).toBe(404);

    // Tenant B attempts to receive
    const receiveB = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/receive`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({ items: [{ variantId: variantId1, receivedQty: 5 }] });
    expect(receiveB.status).toBe(404);

    // Tenant B attempts to cancel
    const cancelB = await request(app.getHttpServer())
      .post(`/api/v1/inventory/transfers/${transferId}/cancel`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(cancelB.status).toBe(404);
  });
});
