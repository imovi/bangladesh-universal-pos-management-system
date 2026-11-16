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
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { truncateTestDatabase } from "./test-db-helper.js";

describe("POS Settings API Endpoint", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let systemDb: SystemDbService;

  let ownerToken: string;
  let cashierToken: string;
  let tenantId: string;

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
    systemDb = app.get(SystemDbService);

    const signup = await tenantsService.signup({
      companyName: "POS Settings Test Shop",
      slug: "pos-settings-shop",
      businessType: "fashion",
      owner: {
        name: "POS Owner",
        email: "owner@possettings.com",
        phone: "+8801700000044",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB01" },
    });

    tenantId = signup.tenantId;

    await systemDb.updateTenantSettings(tenantId, {
      currency: "BDT",
      timezone: "Asia/Dhaka",
      prices_include_tax: true,
      receipt_header: "Welcome to POS Settings Shop",
      receipt_footer: "Thank you for shopping!",
    });

    // Login owner
    const ownerLogin = await authService.login({
      tenantSlug: "pos-settings-shop",
      email: "owner@possettings.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;
    expect(ownerLogin.user.maxDiscountPercent).toBeNull(); // Owner has unlimited discount

    // Create a cashier user
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    const cashierUserRes = await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Counter Cashier",
        email: "cashier@possettings.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
        branchIds: [signup.branchId],
      });
    expect(cashierUserRes.status).toBe(201);

    const cashierLogin = await authService.login({
      tenantSlug: "pos-settings-shop",
      email: "cashier@possettings.com",
      password: "Password123!",
    });
    cashierToken = cashierLogin.accessToken;
    expect(cashierLogin.user.maxDiscountPercent).toBe(5); // Cashier role has 5% default
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("allows cashiers with sale.create to access GET /api/v1/settings/pos", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/settings/pos")
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      shopName: "POS Settings Test Shop",
      currency: "BDT",
      timezone: "Asia/Dhaka",
      pricesIncludeTax: true,
      receiptHeader: "Welcome to POS Settings Shop",
      receiptFooter: "Thank you for shopping!",
    });
  });

  it("forbids cashiers without tenant.read from accessing administrative GET /api/v1/settings", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/settings")
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
  });
});
