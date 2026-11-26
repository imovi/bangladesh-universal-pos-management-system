import "reflect-metadata";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  Controller,
  Get,
  UseGuards,
  INestApplication,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { JwtService, JwtModule } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { v7 as uuidv7 } from "uuid";
import { AppModule } from "../src/app.module.js";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { TenantsService } from "../src/modules/tenants/tenants.service.js";
import { SystemDbService } from "../src/common/database/system-db.service.js";
import { TenantContextService } from "../src/common/database/tenant-context.service.js";
import { ConfigService } from "../src/common/config/config.service.js";
import { PlatformService } from "../src/modules/platform/platform.service.js";
import { ModulesService } from "../src/modules/modules/modules.service.js";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { ModuleGuard } from "../src/common/guards/module.guard.js";
import { RequireModule } from "../src/common/decorators/require-module.decorator.js";
import {
  truncateTestDatabase,
  createTestPrismaClient,
  createTestAdminPrismaClient,
} from "./test-db-helper.js";
import { MODULE_KEYS, type ModuleKey } from "@universal-pos/shared";

// Test-only controller to verify ModuleGuard
@Controller("test-guarded")
@UseGuards(JwtAuthGuard, ModuleGuard)
class TestGuardedController {
  @Get("units-required")
  @RequireModule("units")
  getUnitsOnly() {
    return { ok: true, feature: "units" };
  }
}

describe("Phase 2.0 Module System & Platform Admin Integration Tests", () => {
  let prisma: PrismaClient;
  let adminPrisma: PrismaClient;
  let systemDb: SystemDbService;
  let tenantContext: TenantContextService;
  let tenantsService: TenantsService;
  let platformService: PlatformService;
  let modulesService: ModulesService;
  let jwtService: JwtService;
  let configService: ConfigService;
  let app: INestApplication;

  let fashionTenant: any;
  let chemicalTenant: any;
  let fashionOwnerToken: string;
  let chemicalOwnerToken: string;
  let platformAdminToken: string;
  let platformAdminId: string;

  beforeAll(async () => {
    await truncateTestDatabase();
    prisma = createTestPrismaClient();
    adminPrisma = createTestAdminPrismaClient();
    await prisma.$connect();
    await adminPrisma.$connect();

    // Clean up any residual platform admins
    await adminPrisma.platformAdmin.deleteMany({
      where: { email: { contains: "@platform.local" } },
    });

    // Boot full Nest testing module with AppModule + TestGuardedController
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule, JwtModule.register({})],
      controllers: [TestGuardedController],
      providers: [JwtAuthGuard, ModuleGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    systemDb = app.get(SystemDbService);
    tenantContext = app.get(TenantContextService);
    tenantsService = app.get(TenantsService);
    platformService = app.get(PlatformService);
    modulesService = app.get(ModulesService);
    jwtService = app.get(JwtService);
    configService = app.get(ConfigService);

    // 1. Provision Platform Admin directly in database
    platformAdminId = uuidv7();
    const adminPasswordHash = await argon2.hash("PlatformPass123!");
    await adminPrisma.platformAdmin.create({
      data: {
        id: platformAdminId,
        email: "superadmin@platform.local",
        name: "Super Platform Admin",
        passwordHash: adminPasswordHash,
        isActive: true,
      },
    });

    // 2. Sign up Fashion Tenant (Section 3: fashion signup creates 0 module rows)
    fashionTenant = await tenantsService.signup({
      companyName: "Fashion Brand Ltd",
      slug: "fashion-brand-" + Date.now().toString(36),
      businessType: "fashion",
      owner: {
        name: "Fashion Owner",
        email: "owner@fashionbrand.com",
        phone: "+8801700000001",
        password: "Password123!",
      },
      branch: {
        name: "Flagship",
        code: "FLAG-01",
      },
    });

    // 3. Sign up Chemical Tenant (Section 3: chemical signup gets 4 modules allowed & enabled)
    chemicalTenant = await tenantsService.signup({
      companyName: "ChemCo Industries",
      slug: "chemco-ind-" + Date.now().toString(36),
      businessType: "chemical",
      owner: {
        name: "Chem Owner",
        email: "owner@chemco.com",
        phone: "+8801700000002",
        password: "Password123!",
      },
      branch: {
        name: "Plant 1",
        code: "PLANT-01",
      },
    });

    // Generate tokens
    const accessSecret = configService.get("JWT_ACCESS_SECRET");
    fashionOwnerToken = await jwtService.signAsync(
      {
        sub: fashionTenant.ownerId,
        email: "owner@fashionbrand.com",
        tenantId: fashionTenant.tenantId,
        roles: ["Owner"],
        permissions: ["tenant.read", "tenant.update", "sale.create"],
        isOwner: true,
      },
      { secret: accessSecret, expiresIn: "15m" }
    );

    chemicalOwnerToken = await jwtService.signAsync(
      {
        sub: chemicalTenant.ownerId,
        email: "owner@chemco.com",
        tenantId: chemicalTenant.tenantId,
        roles: ["Owner"],
        permissions: ["tenant.read", "tenant.update", "sale.create"],
        isOwner: true,
      },
      { secret: accessSecret, expiresIn: "15m" }
    );

    const platformSecret = configService.get("PLATFORM_JWT_SECRET");
    platformAdminToken = await jwtService.signAsync(
      {
        sub: platformAdminId,
        email: "superadmin@platform.local",
        name: "Super Platform Admin",
        scope: "platform",
      },
      { secret: platformSecret, expiresIn: "30m" }
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    if (adminPrisma) {
      await adminPrisma.platformAdmin.deleteMany({
        where: { email: { contains: "@platform.local" } },
      });
      await adminPrisma.$disconnect();
    }
    if (prisma) {
      await prisma.$disconnect();
    }
  });

  // Section 2: Data & RLS
  describe("Section 2: Feature Flags RLS Isolation", () => {
    it("proves Tenant A cannot read Tenant B's feature flags under tenant context", async () => {
      // In chemical tenant, 4 module rows exist. In fashion tenant, 0 exist.
      await tenantContext.runWithTenant(fashionTenant.tenantId, async (tx) => {
        const fashionFlags = await tx.featureFlag.findMany();
        expect(fashionFlags.length).toBe(0);

        // Attempting to query chemical tenant's flags by tenantId returns empty set due to RLS
        const crossFlags = await tx.featureFlag.findMany({
          where: { tenantId: chemicalTenant.tenantId },
        });
        expect(crossFlags.length).toBe(0);
      });

      await tenantContext.runWithTenant(chemicalTenant.tenantId, async (tx) => {
        const chemicalFlags = await tx.featureFlag.findMany();
        expect(chemicalFlags.length).toBe(4);
        expect(chemicalFlags.every((f) => f.tenantId === chemicalTenant.tenantId)).toBe(true);
      });
    });
  });

  // Section 3: Signup defaults
  describe("Section 3: Signup Defaults", () => {
    it("chemical signup gets exactly its 4 modules active, fashion signup gets none", async () => {
      const chemicalModules = await modulesService.getModulesForTenant(chemicalTenant.tenantId);
      const activeChemical = chemicalModules.filter((m) => m.active).map((m) => m.key);
      expect(activeChemical.sort()).toEqual(
        ["b2b_wholesale", "batch_expiry", "chemical_safety", "units"].sort()
      );

      const fashionModules = await modulesService.getModulesForTenant(fashionTenant.tenantId);
      const activeFashion = fashionModules.filter((m) => m.active).map((m) => m.key);
      expect(activeFashion).toEqual([]);
    });
  });

  // Section 6: Platform Admin & Role Narrowing
  describe("Section 6: Platform Admin & Role Narrowing", () => {
    it("strictly denies tenant-scoped connection (pos_app) from reading platform_admins", async () => {
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL ROLE pos_app;`;
          return tx.$queryRawUnsafe(`SELECT * FROM public.platform_admins LIMIT 1;`);
        })
      ).rejects.toThrow(/permission denied/i);
    });

    it("allows pos_system role to read and write platform_admins", async () => {
      const admin = await systemDb.findPlatformAdminByEmail("superadmin@platform.local");
      expect(admin).toBeDefined();
      expect(admin?.email).toBe("superadmin@platform.local");
    });

    it("login: wrong password returns 401 with same message as unknown email", async () => {
      const wrongPwRes = await request(app.getHttpServer())
        .post("/api/v1/platform/auth/login")
        .send({ email: "superadmin@platform.local", password: "WrongPassword!" });
      expect(wrongPwRes.status).toBe(401);

      const unknownEmailRes = await request(app.getHttpServer())
        .post("/api/v1/platform/auth/login")
        .send({ email: "doesnotexist@platform.local", password: "AnyPassword123!" });
      expect(unknownEmailRes.status).toBe(401);

      expect(wrongPwRes.body.error?.message).toBe(unknownEmailRes.body.error?.message);
    });

    it("login: valid credentials return accessToken with scope platform and 30m lifetime", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/platform/auth/login")
        .send({ email: "superadmin@platform.local", password: "PlatformPass123!" });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();

      const decoded = jwtService.decode(res.body.data.accessToken) as any;
      expect(decoded.scope).toBe("platform");
      expect(decoded.email).toBe("superadmin@platform.local");
      expect(decoded.exp - decoded.iat).toBe(1800); // 30 minutes
    });

    it("token isolation: tenant access token on /platform/* returns 401", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/platform/tenants")
        .set("Authorization", `Bearer ${fashionOwnerToken}`);
      expect(res.status).toBe(401);
    });

    it("token isolation: platform token on tenant route returns 401", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/modules")
        .set("Authorization", `Bearer ${platformAdminToken}`);
      expect(res.status).toBe(401);
    });

    it("platform admin updates allowed module on tenant and writes audit log", async () => {
      // Platform admin allows 'units' for fashion tenant
      const patchRes = await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${fashionTenant.tenantId}/modules/units`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ allowed: true });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.data.key).toBe("units");
      expect(patchRes.body.data.allowed).toBe(true);
      expect(patchRes.body.data.enabled).toBe(false); // enabled stays as is
      expect(patchRes.body.data.active).toBe(false); // active requires both allowed & enabled

      // Verify audit log has actorUserId=null and platformActor in after
      const logs = await adminPrisma.auditLog.findMany({
        where: {
          tenantId: fashionTenant.tenantId,
          action: "platform.module.update",
        },
      });
      expect(logs.length).toBeGreaterThan(0);
      const log = logs[logs.length - 1];
      expect(log.actorUserId).toBeNull();
      const afterJson = log.after as any;
      expect(afterJson.platformActor.id).toBe(platformAdminId);
      expect(afterJson.platformActor.email).toBe("superadmin@platform.local");
    });
  });

  // Section 4: Tenant Modules API
  describe("Section 4: Tenant Modules API", () => {
    it("GET /modules returns all 8 keys with metadata", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/modules")
        .set("Authorization", `Bearer ${fashionOwnerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(8);

      const keys = res.body.data.map((m: any) => m.key);
      expect(keys).toEqual(MODULE_KEYS);
    });

    it("PATCH /modules/:key returns 400 for unknown key", async () => {
      const res = await request(app.getHttpServer())
        .patch("/api/v1/modules/unknown_module_xyz")
        .set("Authorization", `Bearer ${fashionOwnerToken}`)
        .send({ enabled: true });
      expect(res.status).toBe(400);
    });

    it("PATCH /modules/:key returns 403 MODULE_NOT_ALLOWED if module is not allowed", async () => {
      // pharmacy_catalog is not allowed for fashion tenant
      const res = await request(app.getHttpServer())
        .patch("/api/v1/modules/pharmacy_catalog")
        .set("Authorization", `Bearer ${fashionOwnerToken}`)
        .send({ enabled: true });
      expect(res.status).toBe(403);
      expect(res.body.error?.code).toBe("MODULE_NOT_ALLOWED");
    });

    it("PATCH /modules/:key turns on allowed module and writes audit log", async () => {
      // 'units' was allowed by platform admin in previous test
      const res = await request(app.getHttpServer())
        .patch("/api/v1/modules/units")
        .set("Authorization", `Bearer ${fashionOwnerToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(true);

      const logs = await adminPrisma.auditLog.findMany({
        where: {
          tenantId: fashionTenant.tenantId,
          action: "module.update",
          entityId: "units",
        },
      });
      expect(logs.length).toBeGreaterThan(0);
      const log = logs[logs.length - 1];
      expect(log.actorUserId).toBe(fashionTenant.ownerId);
    });

    it("PATCH /modules/:key returns 409 MODULE_DEPENDENCY_MISSING if turning on while dependency missing", async () => {
      // Platform admin allows pharmacy_catalog for fashion tenant
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${fashionTenant.tenantId}/modules/pharmacy_catalog`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ allowed: true });

      // pharmacy_catalog depends on units and batch_expiry.
      // units is enabled, but batch_expiry is not active!
      const res = await request(app.getHttpServer())
        .patch("/api/v1/modules/pharmacy_catalog")
        .set("Authorization", `Bearer ${fashionOwnerToken}`)
        .send({ enabled: true });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("MODULE_DEPENDENCY_MISSING");
      expect(res.body.error?.missingModules).toContain("batch_expiry");
    });

    it("PATCH /modules/:key returns 409 MODULE_IN_USE_BY_DEPENDENT if turning off module in use", async () => {
      // In chemical tenant: units, batch_expiry, chemical_safety, b2b_wholesale are active.
      // Let's allow and turn on pharmacy_catalog on chemical tenant
      await request(app.getHttpServer())
        .patch(`/api/v1/platform/tenants/${chemicalTenant.tenantId}/modules/pharmacy_catalog`)
        .set("Authorization", `Bearer ${platformAdminToken}`)
        .send({ allowed: true });

      await request(app.getHttpServer())
        .patch("/api/v1/modules/pharmacy_catalog")
        .set("Authorization", `Bearer ${chemicalOwnerToken}`)
        .send({ enabled: true });

      // Now pharmacy_catalog is active on chemical tenant.
      // Attempting to disable 'units' should fail with MODULE_IN_USE_BY_DEPENDENT!
      const res = await request(app.getHttpServer())
        .patch("/api/v1/modules/units")
        .set("Authorization", `Bearer ${chemicalOwnerToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(409);
      expect(res.body.error?.code).toBe("MODULE_IN_USE_BY_DEPENDENT");
      expect(res.body.error?.dependentModules).toContain("pharmacy_catalog");
    });

    it("GET /auth/me returns activeModules array", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${chemicalOwnerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.activeModules)).toBe(true);
      expect(res.body.data.activeModules).toContain("units");
      expect(res.body.data.activeModules).toContain("batch_expiry");
    });

    it("GET /settings/pos returns activeModules array", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/settings/pos")
        .set("Authorization", `Bearer ${chemicalOwnerToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.activeModules)).toBe(true);
      expect(res.body.data.activeModules).toContain("units");
    });
  });

  // Section 5: ModuleGuard Integration Test
  describe("Section 5: ModuleGuard", () => {
    it("allows access when required module is active, and returns 403 MODULE_DISABLED when inactive", async () => {
      // On chemical tenant, 'units' is active -> call should succeed
      const chemRes = await request(app.getHttpServer())
        .get("/api/v1/test-guarded/units-required")
        .set("Authorization", `Bearer ${chemicalOwnerToken}`);
      expect(chemRes.status).toBe(200);
      expect(chemRes.body.data.ok).toBe(true);

      // On a fresh tenant with NO modules active
      const brandNewTenant = await tenantsService.signup({
        companyName: "Brand New Retail",
        slug: "brand-new-retail-" + Date.now().toString(36),
        businessType: "retail",
        owner: {
          name: "Retail Owner",
          email: "owner@retail" + Date.now().toString(36) + ".com",
          phone: "+8801700000099",
          password: "Password123!",
        },
        branch: { name: "Branch 1", code: "B1" },
      });

      const retailToken = await jwtService.signAsync(
        {
          sub: brandNewTenant.ownerId,
          email: "owner@retail.com",
          tenantId: brandNewTenant.tenantId,
          roles: ["Owner"],
          permissions: ["tenant.read"],
          isOwner: true,
        },
        { secret: configService.get("JWT_ACCESS_SECRET"), expiresIn: "15m" }
      );

      const blockedRes = await request(app.getHttpServer())
        .get("/api/v1/test-guarded/units-required")
        .set("Authorization", `Bearer ${retailToken}`);
      expect(blockedRes.status).toBe(403);
      expect(blockedRes.body.error?.code).toBe("MODULE_DISABLED");
    });
  });
});
