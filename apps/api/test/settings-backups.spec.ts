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

describe("Settings Backups API Endpoint (Bug 1 Reproduction & Verification)", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;

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

    const signup = await tenantsService.signup({
      companyName: "Backups Test Shop",
      slug: "backups-test-shop",
      businessType: "fashion",
      owner: {
        name: "Backups Owner",
        email: "owner@backupstest.com",
        phone: "+8801700000088",
        password: "Password123!",
      },
      branch: { name: "Main Branch", code: "MB01" },
    });

    tenantId = signup.tenantId;

    // Login owner
    const ownerLogin = await authService.login({
      tenantSlug: "backups-test-shop",
      email: "owner@backupstest.com",
      password: "Password123!",
    });
    ownerToken = ownerLogin.accessToken;

    // Create a cashier user
    const rolesRes = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);
    const cashierRole = rolesRes.body.data.find((r: any) => r.name === "Cashier");

    await request(app.getHttpServer())
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Backups Cashier",
        email: "cashier@backupstest.com",
        password: "Password123!",
        roleIds: [cashierRole.id],
        branchIds: [signup.branchId],
      });

    const cashierLogin = await authService.login({
      tenantSlug: "backups-test-shop",
      email: "cashier@backupstest.com",
      password: "Password123!",
    });
    cashierToken = cashierLogin.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("Owner gets 200 from GET /api/v1/settings/backups", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/settings/backups")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data).toHaveProperty("lastBackupAt");
    expect(res.body.data).toHaveProperty("lastRestoreDrillAt");
    expect(res.body.data).toHaveProperty("offServerConfigured");
  });

  it("Cashier gets 403 from GET /api/v1/settings/backups", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/settings/backups")
      .set("Authorization", `Bearer ${cashierToken}`);

    expect(res.status).toBe(403);
  });

  it("Unauthenticated request gets 401 from GET /api/v1/settings/backups", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/settings/backups");

    expect(res.status).toBe(401);
  });
});
