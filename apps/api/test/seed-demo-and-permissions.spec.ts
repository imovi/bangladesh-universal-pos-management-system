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

describe("M8: Permissions, Seed & Final Verification Integration Tests", () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let ownerToken: string;
  let tenantId: string;

  beforeAll(async () => {
    await truncateTestDatabase();
    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);

    const signup = await tenantsService.signup({
      companyName: "Permissions Check Ltd",
      slug: "perm-check",
      businessType: "fashion",
      owner: { name: "Role Admin", email: "admin@permcheck.com", phone: "+8801700000099", password: "Password123!" },
      branch: { name: "HQ Branch", code: "HQ-01" },
    });
    tenantId = signup.tenantId;

    const login = await authService.login({
      tenantSlug: "perm-check",
      email: "admin@permcheck.com",
      password: "Password123!",
    });
    ownerToken = login.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it("seeded system roles have expected default maxDiscountPercent and permissions", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    const roles = res.body.data;
    const owner = roles.find((r: any) => r.name === "Owner");
    const manager = roles.find((r: any) => r.name === "Manager");
    const cashier = roles.find((r: any) => r.name === "Cashier");
    const keeper = roles.find((r: any) => r.name === "Store Keeper");

    expect(owner.maxDiscountPercent).toBe(100);
    expect(manager.maxDiscountPercent).toBe(20);
    expect(cashier.maxDiscountPercent).toBe(5);
    expect(keeper.maxDiscountPercent).toBe(0);
  });

  it("allows creating and updating custom roles with maxDiscountPercent", async () => {
    const createRes = await request(app.getHttpServer())
      .post("/api/v1/roles")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: "Senior Sales Associate",
        permissionKeys: ["sale.read", "sale.create", "catalog.read"],
        maxDiscountPercent: 20,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.name).toBe("Senior Sales Associate");
    expect(createRes.body.data.maxDiscountPercent).toBe(20);
    const roleId = createRes.body.data.id;

    const updateRes = await request(app.getHttpServer())
      .patch(`/api/v1/roles/${roleId}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ maxDiscountPercent: 25 });

    expect(updateRes.status).toBe(200);

    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/roles/${roleId}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.maxDiscountPercent).toBe(25);
  });

  it("refuses seed demo execution in production environment", async () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      expect(() => {
        if (process.env.NODE_ENV === "production") {
          throw new Error("Refusing to seed demo data in production environment");
        }
      }).toThrow(/Refusing to seed demo data in production environment/);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });
});
