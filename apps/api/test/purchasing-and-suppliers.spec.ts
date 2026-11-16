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

describe("M4: Suppliers & Purchasing Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let supplierId: string;
  let variantId: string;

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

    // 1. Provision Tenant
    const signup = await tenantsService.signup({
      companyName: "Purchasing Outlet Ltd",
      slug: "purchasing-outlet",
      businessType: "fashion",
      owner: {
        name: "Purchase Manager",
        email: "purchase@outlet.com",
        phone: "+8801700000002",
        password: "Password123!",
      },
      branch: {
        name: "Main Outlet",
        code: "MO-01",
      },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    const loginOwner = await authService.login({
      tenantSlug: "purchasing-outlet",
      email: "purchase@outlet.com",
      password: "Password123!",
    });
    ownerToken = loginOwner.accessToken;

    // Create Cashier
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Purchasing Cashier",
        email: "cashier@outlet.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const loginCashier = await authService.login({
      tenantSlug: "purchasing-outlet",
      email: "cashier@outlet.com",
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;

    // Create product & variant: Cotton Polo
    // Initial cost: 30000 (300 BDT), initial stock: 0
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Cotton Polo",
        sku: "POLO",
        priceMinor: 60000,
        costMinor: 30000,
        options: [{ name: "Size", values: ["L"] }],
      });
    variantId = prodRes.body.data.variants[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /suppliers creates a new supplier with audit log", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Dhaka Garments Co.",
        contactName: "Rahim Uddin",
        phone: "+8801811111111",
        email: "contact@dhakagarments.com",
        address: "Tejgaon I/A, Dhaka",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Dhaka Garments Co.");
    supplierId = res.body.data.id;
  });

  it("POST /purchase-orders creates a PO in draft status", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        supplierId,
        branchId,
        poNumber: "PO-2026-001",
        items: [
          {
            variantId,
            qtyOrdered: 100,
            unitCostMinor: 25000, // 250 BDT
          },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("draft");
    expect(Number(res.body.data.totalEstimatedMinor)).toBe(2500000); // 100 * 25000
    expect(res.body.data.items).toHaveLength(1);
    expect(Number(res.body.data.items[0].qtyOrdered)).toBe(100);
  });

  it("POST /purchase-orders/:id/status transitions draft -> ordered", async () => {
    const ordersRes = await request(app.getHttpServer())
      .get("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`);
    const po = ordersRes.body.data.items[0];

    const res = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${po.id}/status`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ status: "ordered" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ordered");
    expect(res.body.data.orderedAt).toBeDefined();
  });

  it("POST /goods-receipts posts partial receipt and updates stock + weighted average cost", async () => {
    const ordersRes = await request(app.getHttpServer())
      .get("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`);
    const po = ordersRes.body.data.items[0];
    const poItem = po.items[0];

    // Pre-seed opening stock of 20 units at cost 30000 (300 BDT)
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [{ variantId, quantity: 20, unitCostMinor: 30000 }],
      });

    // Receive 40 units at cost 24000 (240 BDT) against the PO
    // Weighted average cost formula:
    // old: 20 units @ 30000 = 600,000
    // recv: 40 units @ 24000 = 960,000
    // total: 60 units, total cost = 1,560,000
    // new_avg = 1,560,000 / 60 = 26000 (260 BDT)
    const grnRes = await request(app.getHttpServer())
      .post("/api/v1/goods-receipts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        purchaseOrderId: po.id,
        branchId,
        grnNumber: "GRN-2026-001",
        items: [
          {
            purchaseOrderItemId: poItem.id,
            variantId,
            qtyReceived: 40,
            unitCostMinor: 24000,
          },
        ],
      });

    expect(grnRes.status).toBe(201);
    expect(grnRes.body.success).toBe(true);

    // Verify PO status is now partially_received
    const updatedPoRes = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${po.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(updatedPoRes.body.data.status).toBe("partially_received");
    expect(Number(updatedPoRes.body.data.items[0].qtyReceived)).toBe(40);

    // Verify stock level is now 60 (20 opening + 40 received)
    const levelRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchId}&variantId=${variantId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(levelRes.body.data[0].qty)).toBe(60);
    expect(levelRes.body.meta.pagination).toBeDefined();

    // Verify variant costMinor updated to new weighted average: 26000
    const varRes = await request(app.getHttpServer())
      .get(`/api/v1/variants/${variantId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(varRes.body.data.costMinor)).toBe(26000);
  });

  it("goods_receipts and supplier_payments are immutable (pos_app cannot UPDATE or DELETE)", async () => {
    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`UPDATE goods_receipts SET notes = 'tampered' WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table goods_receipts/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`DELETE FROM goods_receipts WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table goods_receipts/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`UPDATE supplier_payments SET notes = 'tampered' WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table supplier_payments/);
  });

  it("POST /supplier-payments records payment to supplier", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/supplier-payments")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        supplierId,
        amountMinor: 500000, // 5000 BDT
        paymentMethod: "bank_transfer",
        reference: "TXN-987654",
        notes: "Advance payment",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(Number(res.body.data.amountMinor)).toBe(500000);
  });

  it("POST /goods-receipts final receipt fulfills PO to status 'received'", async () => {
    const ordersRes = await request(app.getHttpServer())
      .get("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`);
    const po = ordersRes.body.data.items[0];
    const poItem = po.items[0];

    // Receive remaining 60 units at cost 26000
    const res = await request(app.getHttpServer())
      .post("/api/v1/goods-receipts")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        purchaseOrderId: po.id,
        branchId,
        grnNumber: "GRN-2026-002",
        items: [
          {
            purchaseOrderItemId: poItem.id,
            variantId,
            qtyReceived: 60,
            unitCostMinor: 26000,
          },
        ],
      });

    expect(res.status).toBe(201);

    const checkPo = await request(app.getHttpServer())
      .get(`/api/v1/purchase-orders/${po.id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(checkPo.body.data.status).toBe("received");
    expect(Number(checkPo.body.data.items[0].qtyReceived)).toBe(100);
  });

  it("Cashier without purchase.manage permission gets 403 on PO and Supplier creation", async () => {
    const supRes = await request(app.getHttpServer())
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ name: "Unauthorized Supplier" });
    expect(supRes.status).toBe(403);

    const poRes = await request(app.getHttpServer())
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ supplierId, branchId, items: [] });
    expect(poRes.status).toBe(403);
  });

  it("GET /suppliers and GET /supplier-payments lists data with pagination", async () => {
    const supList = await request(app.getHttpServer())
      .get("/api/v1/suppliers?search=Dhaka")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(supList.status).toBe(200);
    expect(supList.body.data.items).toHaveLength(1);

    const payList = await request(app.getHttpServer())
      .get(`/api/v1/supplier-payments?supplierId=${supplierId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(payList.status).toBe(200);
    expect(payList.body.data.items).toHaveLength(1);
  });
});
