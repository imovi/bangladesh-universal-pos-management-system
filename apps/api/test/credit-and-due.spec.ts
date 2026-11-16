import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { truncateTestDatabase, getTestAdminDatabaseUrl } from "./test-db-helper.js";

describe("Milestone C2: Credit Sales, Due Collections & Customer Ledger Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;
  let systemDb: SystemDbService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let openShiftId: string;
  let variantId1: string;
  let variantId2: string;
  let managerRoleId: string;

  // Tenant B for isolation test
  let tenantBToken: string;
  let tenantBId: string;

  let customerId: string;

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
    systemDb = app.get(SystemDbService);

    // Setup Tenant A
    const signupA = await tenantsService.signup({
      companyName: "Credit Test Outlet Ltd",
      slug: "credit-outlet",
      businessType: "fashion",
      owner: {
        name: "Credit Owner",
        email: "owner@credit.com",
        phone: "+8801700000031",
        password: "Password123!",
      },
      branch: { name: "Gulshan Branch", code: "GB-01" },
    });
    tenantId = signupA.tenantId;
    branchId = signupA.branchId;

    // Login Owner
    const ownerLogin = await authService.login({
      tenantSlug: "credit-outlet",
      email: "owner@credit.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    // Get roles for Cashier and Manager
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");
    const managerRole = rolesRes.body.data.find((r: any) => r.name === "Manager");
    managerRoleId = managerRole.id;

    // Create Cashier User for Tenant A (default Cashier has NO sale.credit)
    const cashierRes = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Credit Cashier",
        email: "cashier@credit.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
        branchIds: [branchId],
      });
    expect(cashierRes.status).toBe(201);

    const cashierLogin = await authService.login({
      tenantSlug: "credit-outlet",
      email: "cashier@credit.com",
      password: "Password123!",
    });
    cashierToken = cashierLogin.accessToken;

    // Create Register & Open Shift with 10,000 poisha (৳100) opening cash
    const regRes = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        name: "Counter 1",
        code: "REG-1",
      });
    expect(regRes.status).toBe(201);
    registerId = regRes.body.data.id;

    const shiftRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 10000,
        notes: "Shift for credit testing",
      });
    expect(shiftRes.status).toBe(201);
    openShiftId = shiftRes.body.data.id;

    // Setup catalog: tax class, products, opening stock
    const taxRes = await request(app.getHttpServer())
      .post("/api/v1/tax-classes")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Zero Tax", rateBp: 0, isDefault: true });
    const taxClassId = taxRes.body.data.id;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      language: "bn",
      prices_include_tax: false,
    });

    const p1 = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Premium Cotton Shirt",
        sku: "PCS-M",
        priceMinor: 100000, // ৳1,000.00
        costMinor: 60000,
        taxClassId,
        options: [{ name: "Size", values: ["M"] }],
      });
    variantId1 = p1.body.data.variants[0].id;

    const p2 = await request(app.getHttpServer())
      .post("/api/v1/products")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Premium Cotton Panjabi",
        sku: "PCP-L",
        priceMinor: 150000, // ৳1,500.00
        costMinor: 90000,
        taxClassId,
        options: [{ name: "Size", values: ["L"] }],
      });
    variantId2 = p2.body.data.variants[0].id;

    await request(app.getHttpServer())
      .post("/api/v1/inventory/opening-stock")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        items: [
          { variantId: variantId1, quantity: 50, unitCostMinor: 60000 },
          { variantId: variantId2, quantity: 50, unitCostMinor: 90000 },
        ],
      });

    // Create customer with credit limit of ৳500.00 (50,000 poisha)
    const custRes = await request(app.getHttpServer())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Hasan Mahmud",
        phone: "+8801711223344",
        creditLimitMinor: 50000,
      });
    customerId = custRes.body.data.id;

    // Setup Tenant B for cross-tenant isolation verification
    const signupB = await tenantsService.signup({
      companyName: "Competitor Outlet Ltd",
      slug: "competitor-outlet",
      businessType: "fashion",
      owner: {
        name: "Tenant B Owner",
        email: "owner@competitor.com",
        phone: "+8801700000099",
        password: "Password123!",
      },
      branch: { name: "Banani Branch", code: "BB-01" },
    });
    tenantBId = signupB.tenantId;
    const loginB = await authService.login({
      tenantSlug: "competitor-outlet",
      email: "owner@competitor.com",
      password: "Password123!",
    });
    tenantBToken = loginB.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("1. Cashier without sale.credit permission cannot make a credit sale", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${cashierToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        branchId,
        shiftId: openShiftId,
        customerId,
        items: [{ variantId: variantId1, quantity: 1 }],
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 60000 }], // 40,000 poisha unpaid
      });

    expect(res.status).toBe(403);
  });

  it("2. Credit sale without customer attached is rejected with 400", async () => {
    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        branchId,
        shiftId: openShiftId,
        // customerId omitted
        items: [{ variantId: variantId1, quantity: 1 }],
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 60000 }],
      });

    expect(res.status).toBe(400);
  });

  it("3. Credit sale that would exceed customer credit limit is rejected with 409 CREDIT_LIMIT_EXCEEDED", async () => {
    // Customer limit is 50,000 poisha. Attempting a due of 60,000 poisha.
    // We create a temporary manager user who has sale.credit but NOT sale.credit.override
    const managerRes = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Branch Manager",
        email: "manager@credit.com",
        password: "Password123!",
        roleIds: [managerRoleId],
        branchIds: [branchId],
      });
    expect(managerRes.status).toBe(201);

    const managerLogin = await authService.login({
      tenantSlug: "credit-outlet",
      email: "manager@credit.com",
      password: "Password123!",
    });
    const managerToken = managerLogin.accessToken;

    const saleId = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${managerToken}`)
      .set("Idempotency-Key", saleId)
      .send({
        id: saleId,
        branchId,
        shiftId: openShiftId,
        customerId,
        items: [{ variantId: variantId1, quantity: 1 }], // 100,000 poisha
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 40000 }], // unpaid: 60,000 poisha > 50,000 limit
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CREDIT_LIMIT_EXCEEDED");
    expect(res.body.error.limitMinor).toBe(50000);
    expect(res.body.error.currentDueMinor).toBe(0);
    expect(res.body.error.attemptedDueMinor).toBe(60000);
  });

  let creditSale1Id: string;
  let creditSale2Id: string;

  it("4. Credit sale within limit succeeds and persists dueMinor", async () => {
    // Total: 100,000 poisha, Paid: 70,000 poisha, Due: 30,000 poisha (<= 50,000 limit)
    creditSale1Id = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", creditSale1Id)
      .send({
        id: creditSale1Id,
        branchId,
        shiftId: openShiftId,
        customerId,
        items: [{ variantId: variantId1, quantity: 1 }],
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 70000 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.data.dueMinor).toBe(30000);
    expect(res.body.data.paidMinor).toBe(70000);

    // Check customer balance
    const balRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/balance`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(balRes.status).toBe(200);
    expect(balRes.body.data.currentDueMinor).toBe(30000);
    expect(balRes.body.data.creditLimitMinor).toBe(50000);
    expect(balRes.body.data.availableCreditMinor).toBe(20000);
  });

  it("5. Owner with sale.credit.override can exceed credit limit", async () => {
    // Current due is 30,000. Customer limit is 50,000.
    // Adding another sale with 40,000 due (total due would be 70,000 > 50,000).
    // Owner possesses sale.credit.override, so it should succeed.
    creditSale2Id = uuidv7();
    const res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", creditSale2Id)
      .send({
        id: creditSale2Id,
        branchId,
        shiftId: openShiftId,
        customerId,
        items: [{ variantId: variantId1, quantity: 1 }], // 100,000 poisha
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 60000 }], // due: 40,000 poisha
      });

    expect(res.status).toBe(201);
    expect(res.body.data.dueMinor).toBe(40000);

    // Total due is now 30,000 + 40,000 = 70,000
    const balRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/balance`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(balRes.status).toBe(200);
    expect(balRes.body.data.currentDueMinor).toBe(70000);
    expect(balRes.body.data.availableCreditMinor).toBe(0);
  });

  it("6. FIFO Allocation: collecting payment applies to oldest due sales first", async () => {
    // Sale 1 has due 30,000. Sale 2 has due 40,000. Total due: 70,000.
    // Collect 45,000 poisha payment:
    // Should allocate 30,000 to Sale 1 (clearing it to 0) and 15,000 to Sale 2 (leaving 25,000 due).
    const paymentId = uuidv7();
    const payRes = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/payments`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        id: paymentId,
        shiftId: openShiftId,
        amountMinor: 45000,
        paymentMethod: "cash",
        reference: "RECEIPT-DUE-01",
        notes: "Partial settlement",
      });

    expect(payRes.status).toBe(201);
    expect(payRes.body.data.paymentNumber).toMatch(/^GB-01-PAY-\d{6}-\d{4}$/);
    expect(payRes.body.data.allocations).toHaveLength(2);

    const alloc1 = payRes.body.data.allocations.find((a: any) => a.saleId === creditSale1Id);
    const alloc2 = payRes.body.data.allocations.find((a: any) => a.saleId === creditSale2Id);

    expect(alloc1).toBeDefined();
    expect(alloc1.allocatedMinor).toBe(30000);
    expect(alloc2).toBeDefined();
    expect(alloc2.allocatedMinor).toBe(15000);

    // Verify Sale 1 and Sale 2 dueMinor in database
    const s1Res = await request(app.getHttpServer())
      .get(`/api/v1/sales/${creditSale1Id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(s1Res.body.data.dueMinor)).toBe(0);

    const s2Res = await request(app.getHttpServer())
      .get(`/api/v1/sales/${creditSale2Id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(s2Res.body.data.dueMinor)).toBe(25000);

    // Customer balance current due is now 25,000
    const balRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/balance`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(balRes.body.data.currentDueMinor).toBe(25000);
  });

  it("7. Shift cash summary accurately includes due collections", async () => {
    // Opening cash: 10,000
    // Sale 1 cash: 70,000
    // Sale 2 cash: 60,000
    // Customer payment cash collection: 45,000
    // Expected cash: 10,000 + 70,000 + 60,000 + 45,000 = 185,000 poisha
    const shiftRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${openShiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(shiftRes.status).toBe(200);
    expect(shiftRes.body.data.summary.expectedCashMinor).toBe(185000);
    expect(shiftRes.body.data.summary.paymentMethodTotalsMinor.cash).toBe(175000); // 70k + 60k + 45k
  });

  it("8. Return on a due sale reduces due first before issuing cash refund", async () => {
    // Create Sale 3 with 1 item (variantId1, 100,000 poisha)
    // Paid 40,000 cash, Due 60,000
    const sale3Id = uuidv7();
    const s3Res = await request(app.getHttpServer())
      .post("/api/v1/sales")
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", sale3Id)
      .send({
        id: sale3Id,
        branchId,
        shiftId: openShiftId,
        customerId,
        items: [{ variantId: variantId1, quantity: 1 }],
        expectedTotalMinor: 100000,
        payments: [{ paymentMethod: "cash", amountMinor: 40000 }],
      });
    expect(s3Res.status).toBe(201);
    const saleItemId = s3Res.body.data.items[0].id;

    // Return the item: value 100,000 poisha
    // Due on sale is 60,000.
    // Due reduction: 60,000 (clears the due)
    // Cash refund: 40,000 (returned to customer)
    const returnId = uuidv7();
    const retRes = await request(app.getHttpServer())
      .post(`/api/v1/sales/${sale3Id}/returns`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .set("Idempotency-Key", returnId)
      .send({
        id: returnId,
        shiftId: openShiftId,
        refundMethod: "cash",
        reason: "Customer changed mind",
        items: [{ saleItemId, quantity: 1, condition: "resellable" }],
      });

    expect(retRes.status).toBe(201);
    expect(retRes.body.data.reason).toContain("[due_reduced:60000]");

    // Check Sale 3 due is now 0
    const checkSale3 = await request(app.getHttpServer())
      .get(`/api/v1/sales/${sale3Id}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(Number(checkSale3.body.data.dueMinor)).toBe(0);

    // Drawer cash check: drawer had 185,000 + 40,000 (from sale 3) = 225,000.
    // Cash refunded was 40,000. New expected cash: 185,000 poisha.
    const shiftRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${openShiftId}`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(shiftRes.body.data.summary.expectedCashMinor).toBe(185000);
  });

  it("9. Customer statement opening balance for date range matches prior balance", async () => {
    // Query statement for all transactions
    const fullStatementRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/statement`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(fullStatementRes.status).toBe(200);
    expect(fullStatementRes.body.data.openingBalanceMinor).toBe(0);
    // Closing balance must match GET /customers/:id/balance currentDueMinor
    const balRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/balance`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(fullStatementRes.body.data.closingBalanceMinor).toBe(balRes.body.data.currentDueMinor);

    // Query statement starting tomorrow: opening balance must equal closing balance of today
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const futureStmtRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/statement?startDate=${tomorrow}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(futureStmtRes.status).toBe(200);
    expect(futureStmtRes.body.data.openingBalanceMinor).toBe(balRes.body.data.currentDueMinor);
    expect(futureStmtRes.body.data.items).toHaveLength(0);
  });

  it("10. Due ageing report (/reports/due) groups buckets accurately", async () => {
    const dueRepRes = await request(app.getHttpServer())
      .get(`/api/v1/reports/due?branchId=${branchId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(dueRepRes.status).toBe(200);
    expect(dueRepRes.body.data.summary.totalDueMinor).toBe(25000); // 25,000 remaining on Sale 2
    expect(dueRepRes.body.data.summary.bucket0to30Minor).toBe(25000);
    expect(dueRepRes.body.data.customers).toHaveLength(1);
    expect(dueRepRes.body.data.customers[0].customerId).toBe(customerId);
    expect(dueRepRes.body.data.customers[0].totalDueMinor).toBe(25000);
  });

  it("11. Tenant isolation: Tenant B cannot access Tenant A's customer balance, statement or payments", async () => {
    // Tenant B attempts to read Tenant A customer balance
    const balB = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/balance`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(balB.status).toBe(404);

    // Tenant B attempts to read Tenant A customer statement
    const stmtB = await request(app.getHttpServer())
      .get(`/api/v1/customers/${customerId}/statement`)
      .set("Authorization", `Bearer ${tenantBToken}`);
    expect(stmtB.status).toBe(404);

    // Tenant B attempts to post payment to Tenant A customer
    const payB = await request(app.getHttpServer())
      .post(`/api/v1/customers/${customerId}/payments`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .send({
        shiftId: openShiftId,
        amountMinor: 5000,
        paymentMethod: "cash",
      });
    expect(payB.status).toBe(404);
  });
});
