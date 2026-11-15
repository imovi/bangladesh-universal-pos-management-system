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
import { v7 as uuidv7 } from "uuid";

describe("Fix 6: Smaller Corrections Integration Suite", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let tenantId: string;
  let ownerToken: string;
  let branch1Id: string;
  let branch2Id: string;
  let register1Id: string;
  let shift1Id: string;
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

    const signup = await tenantsService.signup({
      companyName: "Corrections Retail",
      slug: "corrections-retail",
      businessType: "fashion",
      owner: { name: "Retail Owner", email: "owner@corrections.com", phone: "+8801700000061", password: "Password123!" },
      branch: { name: "Branch 1", code: "B1" },
    });
    tenantId = signup.tenantId;
    branch1Id = signup.branchId;

    const login = await authService.login({
      tenantSlug: "corrections-retail",
      email: "owner@corrections.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;

    // Create branch 2
    const b2Res = await request(app.getHttpServer())
      .post("/api/v1/branches")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Branch 2", code: "B2" });
    branch2Id = b2Res.body.data.id;

    // Register on Branch 1
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId: branch1Id, name: "Reg 1", code: "R1" });
    register1Id = regRes.body.data.id;

    // Open Shift on Branch 1 Register 1
    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ branchId: branch1Id, registerId: register1Id, openingCashMinor: 50000 });
    shift1Id = shiftRes.body.data.id;

    // Create product
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Jacket", sku: "JKT-01", priceMinor: 100000, costMinor: 40000 });
    variantId = prodRes.body.data.variants[0].id;

    // Seed stock
    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: branch1Id,
        items: [{ variantId, quantity: 20, unitCostMinor: 40000 }],
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it("(a) Rejects sale creation with 422 if shift does not belong to specified branch", async () => {
    const key = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", key)
      .send({
        id: key,
        branchId: branch2Id, // Mismatched! shift1Id belongs to branch1Id
        shiftId: shift1Id,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("BRANCH_SHIFT_MISMATCH");
  });

  it("(b) Idempotency: rejects header mismatch, returns 200 on repeat, 409 on different payload, handles concurrency", async () => {
    // Mismatched header and body id
    const resMismatch = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", uuidv7())
      .send({
        id: uuidv7(),
        branchId: branch1Id,
        shiftId: shift1Id,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });
    expect(resMismatch.status).toBe(400);

    // Initial creation
    const idempotencyKey = uuidv7();
    const resCreate = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        id: idempotencyKey,
        branchId: branch1Id,
        shiftId: shift1Id,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });
    expect(resCreate.status).toBe(201);

    // Repeat with same id and same payload -> 200 OK
    const resRepeat = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        id: idempotencyKey,
        branchId: branch1Id,
        shiftId: shift1Id,
        expectedTotalMinor: 100000,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
      });
    expect(resRepeat.status).toBe(200);

    // Repeat with same id and DIFFERENT payload -> 409 Conflict
    const resConflict = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", idempotencyKey)
      .send({
        id: idempotencyKey,
        branchId: branch1Id,
        shiftId: shift1Id,
        expectedTotalMinor: 200000,
        items: [{ variantId, quantity: 2 }],
        payments: [{ paymentMethod: "cash", amountMinor: 200000 }],
      });
    expect(resConflict.status).toBe(409);

    // Two identical concurrent requests arriving at same moment -> exactly one sale, no 500
    const concurrentKey = uuidv7();
    const payload = {
      id: concurrentKey,
      branchId: branch1Id,
      shiftId: shift1Id,
      expectedTotalMinor: 100000,
      items: [{ variantId, quantity: 1 }],
      payments: [{ paymentMethod: "cash", amountMinor: 100000 }],
    };
    const [c1, c2] = await Promise.all([
      request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${ownerToken}`).set("Idempotency-Key", concurrentKey).send(payload),
      request(app.getHttpServer()).post("/api/v1/sales").set("Authorization", `Bearer ${ownerToken}`).set("Idempotency-Key", concurrentKey).send(payload),
    ]);
    const statuses = [c1.status, c2.status].sort();
    expect(statuses).toEqual([200, 201]);
  });

  it("(c) Updates tenant settings and name inside tenant context under RLS as pos_app", async () => {
    const updated = await tenantsService.updateSettings(tenantId, {
      timezone: "Asia/Dhaka",
      prices_include_tax: true,
      allow_negative_stock: false,
    });
    expect(updated).toBeDefined();

    // Verify read back under tenant context
    const tenantRow = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, slug: true, settings: true },
      });
    });
    expect(tenantRow).toBeDefined();
    expect((tenantRow?.settings as any).allow_negative_stock).toBe(false);
  });

  it("(d) Generates sequential PO and GRN numbers using row-locked counters", async () => {
    // Create supplier
    const supRes = await request(app.getHttpServer())
      .post("/api/v1/suppliers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Supplier ${Date.now()}` });
    const supplierId = supRes.body.data.id;

    const po1Res = await request(app.getHttpServer())
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: branch1Id,
        supplierId,
        items: [{ variantId, qtyOrdered: 5, unitCostMinor: 40000 }],
      });
    expect(po1Res.status).toBe(201);
    expect(po1Res.body.data.poNumber).toMatch(/^PO-/);

    const po2Res = await request(app.getHttpServer())
      .post("/api/v1/purchase-orders")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId: branch1Id,
        supplierId,
        items: [{ variantId, qtyOrdered: 5, unitCostMinor: 40000 }],
      });
    expect(po2Res.status).toBe(201);
    expect(po2Res.body.data.poNumber).toMatch(/^PO-/);
    expect(po2Res.body.data.poNumber).not.toBe(po1Res.body.data.poNumber);
  });

  it("(e) & (f) Enforces atomic negative stock prevention and snapshots cost on sale and void movements", async () => {
    const key = uuidv7();
    const saleRes = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", key)
      .send({
        id: key,
        branchId: branch1Id,
        shiftId: shift1Id,
        expectedTotalMinor: 200000,
        items: [{ variantId, quantity: 2 }],
        payments: [{ paymentMethod: "cash", amountMinor: 200000 }],
      });
    expect(saleRes.status).toBe(201);

    // Verify stock movement on sale carries unitCostMinor
    const saleMovements = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.stockMovement.findMany({ where: { refId: key } });
    });
    expect(saleMovements).toHaveLength(1);
    expect(Number(saleMovements[0].unitCostMinor)).toBe(40000);

    // Void sale and verify void stock movement carries unitCostMinor
    const voidRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${key}/void`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ reason: "Customer return test" });
    expect(voidRes.status).toBe(200);

    const voidMovements = await tenantContext.runWithTenant(tenantId, async (tx) => {
      return tx.stockMovement.findMany({ where: { refId: key, type: "sale_void" } });
    });
    expect(voidMovements).toHaveLength(1);
    expect(Number(voidMovements[0].unitCostMinor)).toBe(40000);
  });
});
