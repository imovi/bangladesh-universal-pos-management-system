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
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { InventoryService } from "../src/modules/inventory/inventory.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("M3: Inventory Ledger Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let systemDb: SystemDbService;
  let inventoryService: InventoryService;

  let ownerTokenA: string;
  let cashierTokenA: string;
  let tenantAId: string;
  let branchAId: string;
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
    tenantContext = app.get(TenantContextService);
    systemDb = app.get(SystemDbService);
    inventoryService = app.get(InventoryService);

    // 1. Provision Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Inventory Fashion Ltd",
      slug: "inv-fashion",
      businessType: "fashion",
      owner: {
        name: "Inventory Owner",
        email: "owner@invfashion.com",
        phone: "+8801700000001",
        password: "Password123!",
      },
      branch: {
        name: "Central Warehouse",
        code: "CWH-01",
      },
    });
    tenantAId = signupA.tenantId;
    branchAId = signupA.branchId;

    const loginOwner = await authService.login({
      tenantSlug: "inv-fashion",
      email: "owner@invfashion.com",
      password: "Password123!",
    });
    ownerTokenA = loginOwner.accessToken;

    // Create Cashier
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerTokenA}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Inv Cashier",
        email: "cashier@invfashion.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const loginCashier = await authService.login({
      tenantSlug: "inv-fashion",
      email: "cashier@invfashion.com",
      password: "Password123!",
    });
    cashierTokenA = loginCashier.accessToken;

    // Create 2 test products
    const prodRes = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        name: "Cotton T-Shirt",
        sku: "TSHIRT",
        priceMinor: 50000,
        costMinor: 25000,
        reorderLevel: 10,
        options: [{ name: "Size", values: ["M", "L"] }],
      });

    variantAId = prodRes.body.data.variants[0].id;
    variantBId = prodRes.body.data.variants[1].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /inventory/opening-stock creates opening stock movements and sets stock_levels", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        branchId: branchAId,
        items: [
          { variantId: variantAId, quantity: 50, unitCostMinor: 25000 },
          { variantId: variantBId, quantity: 30, unitCostMinor: 25000 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);

    // Verify stock levels via GET
    const levelsRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchAId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(levelsRes.status).toBe(200);
    const levels = levelsRes.body.data;
    const vALevel = levels.find((l: any) => l.variantId === variantAId);
    const vBLevel = levels.find((l: any) => l.variantId === variantBId);

    expect(Number(vALevel.qty)).toBe(50);
    expect(Number(vBLevel.qty)).toBe(30);
  });

  it("POST /inventory/adjustment requires reason and permissions", async () => {
    // 1. Cashier without stock.adjust permission gets 403
    const cashierRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/adjustment")
      .set("Authorization", `Bearer ${cashierTokenA}`)
      .send({
        branchId: branchAId,
        variantId: variantAId,
        qtyDelta: -5,
        reason: "Damaged in transit",
      });
    expect(cashierRes.status).toBe(403);

    // 2. Owner adjusts stock -> 201
    const ownerRes = await request(app.getHttpServer())
      .post("/api/v1/inventory/adjustment")
      .set("Authorization", `Bearer ${ownerTokenA}`)
      .send({
        branchId: branchAId,
        variantId: variantAId,
        qtyDelta: -5,
        reason: "Damaged in transit",
      });
    expect(ownerRes.status).toBe(201);

    // Verify new stock level is 45 (50 - 5)
    const checkRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchAId}&variantId=${variantAId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);
    expect(Number(checkRes.body.data[0].qty)).toBe(45);
  });

  it("pos_app CANNOT UPDATE or DELETE on stock_movements (append-only ledger)", async () => {
    await expect(
      tenantContext.runWithTenant(tenantAId, async (tx) => {
        return tx.$executeRaw`
          UPDATE stock_movements SET qty_delta = 999 WHERE tenant_id = ${tenantAId}::uuid;
        `;
      }),
    ).rejects.toThrow(/permission denied for table stock_movements/);

    await expect(
      tenantContext.runWithTenant(tenantAId, async (tx) => {
        return tx.$executeRaw`
          DELETE FROM stock_movements WHERE tenant_id = ${tenantAId}::uuid;
        `;
      }),
    ).rejects.toThrow(/permission denied for table stock_movements/);
  });

  it("20 concurrent movements on the same variant end with exact quantity", async () => {
    // Starting quantity of variant B is 30.
    // Execute 20 concurrent deltas: 10 of +2, 10 of -1 -> total net change = +10 -> expected: 40.
    const promises: Promise<any>[] = [];

    for (let i = 0; i < 20; i++) {
      const delta = i % 2 === 0 ? 2 : -1;
      promises.push(
        tenantContext.runWithTenant(tenantAId, async (tx) => {
          return inventoryService.applyMovements(tenantAId, tx, [
            {
              branchId: branchAId,
              variantId: variantBId,
              qtyDelta: delta,
              type: "adjustment",
              reason: `Concurrent delta ${i}`,
            },
          ]);
        }),
      );
    }

    await Promise.all(promises);

    const checkRes = await request(app.getHttpServer())
      .get(`/api/v1/inventory/levels?branchId=${branchAId}&variantId=${variantBId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(Number(checkRes.body.data[0].qty)).toBe(40);
  });

  it("invariant: stock_levels.qty equals sum of movements.qty_delta after randomized operations", async () => {
    // Execute 30 randomized operations across variant A and variant B
    for (let i = 0; i < 30; i++) {
      const variantId = i % 2 === 0 ? variantAId : variantBId;
      const delta = ((i * 7) % 11) - 5; // values between -5 and +5
      if (delta === 0) continue;

      await tenantContext.runWithTenant(tenantAId, async (tx) => {
        await inventoryService.applyMovements(tenantAId, tx, [
          {
            branchId: branchAId,
            variantId,
            qtyDelta: delta,
            type: "adjustment",
            reason: `Randomized test step ${i}`,
          },
        ]);
      });
    }

    // Check invariants
    await tenantContext.runWithTenant(tenantAId, async (tx) => {
      for (const varId of [variantAId, variantBId]) {
        const level = await tx.stockLevel.findUnique({
          where: {
            tenantId_branchId_variantId: {
              tenantId: tenantAId,
              branchId: branchAId,
              variantId: varId,
            },
          },
        });

        const movements = await tx.stockMovement.findMany({
          where: { tenantId: tenantAId, branchId: branchAId, variantId: varId },
        });

        const sumDeltas = movements.reduce((acc: number, m: any) => acc + Number(m.qtyDelta), 0);
        expect(Number(level?.qty)).toBe(sumDeltas);
      }
    });
  });

  it("allow_negative_stock tenant setting: rejects negative stock when false", async () => {
    // Set allow_negative_stock = false in tenant settings
    await systemDb.updateTenantSettings(tenantAId, { allow_negative_stock: false });
    inventoryService.clearSettingsCache(tenantAId);

    // Try driving variant A below zero
    await expect(
      tenantContext.runWithTenant(tenantAId, async (tx) => {
        return inventoryService.applyMovements(tenantAId, tx, [
          {
            branchId: branchAId,
            variantId: variantAId,
            qtyDelta: -1000, // Exceeds current stock
            type: "sale",
            reason: "Excessive sale",
          },
        ]);
      }),
    ).rejects.toThrow(/Insufficient stock/);
  });

  it("GET /inventory/movements returns paginated movements", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/movements?branchId=${branchAId}&limit=10&page=1`)
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.meta.total).toBeGreaterThan(0);
  });

  it("GET /inventory/low-stock returns items below reorder level", async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/inventory/low-stock?branchId=${branchAId}`)
      .set("Authorization", `Bearer ${ownerTokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
