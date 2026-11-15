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

describe("M5: Customers, Registers & Shifts Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let tenantContext: TenantContextService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;

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
      companyName: "Shift Fashion Store Ltd",
      slug: "shift-store",
      businessType: "fashion",
      owner: {
        name: "Store Owner",
        email: "owner@shiftstore.com",
        phone: "+8801700000003",
        password: "Password123!",
      },
      branch: {
        name: "Flagship Outlet",
        code: "FO-01",
      },
    });
    tenantId = signup.tenantId;
    branchId = signup.branchId;

    const loginOwner = await authService.login({
      tenantSlug: "shift-store",
      email: "owner@shiftstore.com",
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
        name: "Front Desk Cashier",
        email: "cashier@shiftstore.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
      });

    const loginCashier = await authService.login({
      tenantSlug: "shift-store",
      email: "cashier@shiftstore.com",
      password: "Password123!",
    });
    cashierToken = loginCashier.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /customers normalizes phone number and prevents duplicates", async () => {
    // 1. Create with raw 11-digit local format "01799998888"
    const res1 = await request(app.getHttpServer())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        name: "Shakib Khan",
        phone: "01799998888",
        email: "shakib@test.com",
      });

    expect(res1.status).toBe(201);
    expect(res1.body.success).toBe(true);
    expect(res1.body.data.phone).toBe("+8801799998888");

    // 2. Duplicate with spaces/dashes should normalize and conflict (409)
    const res2 = await request(app.getHttpServer())
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        name: "Shakib Khan Duplicate",
        phone: "+880 1799-998888",
      });

    expect(res2.status).toBe(409);
  });

  it("POST /registers creates register", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/registers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        branchId,
        name: "Counter 01",
        code: "REG-01",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.code).toBe("REG-01");
    registerId = res.body.data.id;
  });

  it("POST /shifts/open opens shift for cashier", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 100000, // 1,000 BDT
        notes: "Morning shift start",
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("open");
    expect(Number(res.body.data.openingCashMinor)).toBe(100000);
    shiftId = res.body.data.id;
  });

  it("Cannot open a second shift on the same register while first is open (partial unique index)", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 50000,
      });

    expect(res.status).toBe(409);
  });

  it("POST /shifts/:id/cash-movements adds cash in and cash out", async () => {
    // 1. Cash In 20,000 poisha (200 BDT)
    const inRes = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/cash-movements`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        type: "cash_in",
        amountMinor: 20000,
        reason: "Floated change from manager",
      });

    expect(inRes.status).toBe(201);
    expect(inRes.body.success).toBe(true);

    // 2. Cash Out 5,000 poisha (50 BDT)
    const outRes = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/cash-movements`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        type: "cash_out",
        amountMinor: 5000,
        reason: "Bought tea & snacks for counter",
      });

    expect(outRes.status).toBe(201);
    expect(outRes.body.success).toBe(true);
  });

  it("cash_movements are append-only (pos_app cannot UPDATE or DELETE)", async () => {
    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`UPDATE cash_movements SET amount_minor = 99999 WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table cash_movements/);

    await expect(
      tenantContext.runWithTenant(tenantId, async (tx) => {
        return tx.$executeRaw`DELETE FROM cash_movements WHERE tenant_id = ${tenantId}::uuid;`;
      }),
    ).rejects.toThrow(/permission denied for table cash_movements/);
  });

  it("POST /shifts/:id/close calculates expected cash and cash difference correctly", async () => {
    // Expected cash: 100,000 (opening) + 20,000 (cash in) - 5,000 (cash out) = 115,000
    // Actual closing cash: 114,000
    // Difference: 114,000 - 115,000 = -1,000
    const res = await request(app.getHttpServer())
      .post(`/api/v1/shifts/${shiftId}/close`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        closingCashMinor: 114000,
        notes: "Shift closed with 10 BDT shortage",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("closed");
    expect(Number(res.body.data.expectedCashMinor)).toBe(115000);
    expect(Number(res.body.data.cashDifferenceMinor)).toBe(-1000);
    expect(res.body.data.closedAt).toBeDefined();

    // Now that shift is closed, a new shift CAN be opened on register
    const reopenRes = await request(app.getHttpServer())
      .post("/api/v1/shifts/open")
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({
        registerId,
        branchId,
        openingCashMinor: 114000,
      });

    expect(reopenRes.status).toBe(201);
  });

  it("GET endpoints: customers, registers, shifts by ID and list", async () => {
    // 1. Search customer by name
    const custRes = await request(app.getHttpServer())
      .get("/api/v1/customers?search=Shakib")
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(custRes.status).toBe(200);
    expect(custRes.body.data.items).toHaveLength(1);

    // 2. Registers list
    const regRes = await request(app.getHttpServer())
      .get(`/api/v1/registers?branchId=${branchId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(regRes.status).toBe(200);
    expect(regRes.body.data.length).toBeGreaterThan(0);

    // 3. Shifts list
    const shiftsRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts?registerId=${registerId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(shiftsRes.status).toBe(200);
    expect(shiftsRes.body.data.items.length).toBeGreaterThan(0);

    // 4. Shift by ID
    const shiftRes = await request(app.getHttpServer())
      .get(`/api/v1/shifts/${shiftId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(shiftRes.status).toBe(200);
    expect(shiftRes.body.data.id).toBe(shiftId);
    expect(shiftRes.body.data.cashMovements).toHaveLength(2);

    // 5. Customer update and by ID
    const custId = custRes.body.data.items[0].id;
    const updateCustRes = await request(app.getHttpServer())
      .patch(`/api/v1/customers/${custId}`)
      .set("Authorization", `Bearer ${cashierToken}`)
      .send({ address: "Banani, Dhaka" });
    expect(updateCustRes.status).toBe(200);
    expect(updateCustRes.body.data.address).toBe("Banani, Dhaka");

    const getCustRes = await request(app.getHttpServer())
      .get(`/api/v1/customers/${custId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(getCustRes.status).toBe(200);
    expect(getCustRes.body.data.address).toBe("Banani, Dhaka");

    // 6. Register update and by ID
    const updateRegRes = await request(app.getHttpServer())
      .patch(`/api/v1/registers/${registerId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: "Main Counter Renamed" });
    expect(updateRegRes.status).toBe(200);
    expect(updateRegRes.body.data.name).toBe("Main Counter Renamed");

    const getRegRes = await request(app.getHttpServer())
      .get(`/api/v1/registers/${registerId}`)
      .set("Authorization", `Bearer ${cashierToken}`);
    expect(getRegRes.status).toBe(200);
    expect(getRegRes.body.data.name).toBe("Main Counter Renamed");
  });
});
