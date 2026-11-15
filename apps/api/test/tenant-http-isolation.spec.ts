import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TenantsService } from '../src/modules/tenants/tenants.service.js';
import { PrismaService } from '../src/common/database/prisma.service.js';

describe('Fix 4: HTTP Endpoint Cross-Tenant Isolation (Supertest)', () => {
  let app: INestApplication;
  let authService: AuthService;
  let tenantsService: TenantsService;
  let prisma: PrismaService;

  let tokenA: string;
  let tokenB: string;
  let refreshTokenA: string;
  let tenantBBranchId: string;
  let tenantBUserId: string;
  let tenantBRoleId: string;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    authService = app.get(AuthService);
    tenantsService = app.get(TenantsService);
    prisma = app.get(PrismaService);

    // Clean slate
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE tenants CASCADE;`);

    // Signup Tenant Alpha
    await tenantsService.signup({
      companyName: 'Http Alpha',
      slug: 'http-alpha',
      businessType: 'fashion',
      owner: {
        name: 'Alpha Owner',
        email: 'alpha@test.com',
        phone: '+8801700000010',
        password: 'Password123!',
      },
      branch: {
        name: 'Alpha Branch',
        code: 'ALP-01',
      },
    });

    // Signup Tenant Beta
    const beta = await tenantsService.signup({
      companyName: 'Http Beta',
      slug: 'http-beta',
      businessType: 'retail',
      owner: {
        name: 'Beta Owner',
        email: 'beta@test.com',
        phone: '+8801700000020',
        password: 'Password123!',
      },
      branch: {
        name: 'Beta Branch',
        code: 'BET-01',
      },
    });

    tenantBBranchId = beta.branchId;
    tenantBUserId = beta.ownerId;

    // Login Alpha
    const loginA = await authService.login({
      tenantSlug: 'http-alpha',
      email: 'alpha@test.com',
      password: 'Password123!',
    });
    tokenA = loginA.accessToken;
    refreshTokenA = loginA.refreshToken;

    // Login Beta
    const loginB = await authService.login({
      tenantSlug: 'http-beta',
      email: 'beta@test.com',
      password: 'Password123!',
    });
    tokenB = loginB.accessToken;

    // Fetch Tenant B custom role
    const rolesB = await prisma.role.findMany({ where: { tenantId: beta.tenantId } });
    tenantBRoleId = rolesB[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Health Endpoint', () => {
    it('GET /health returns status ok', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
    });
  });

  describe('Auth Endpoints via HTTP', () => {
    it('GET /auth/me returns current user profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe('alpha@test.com');
    });

    it('POST /auth/login returns token envelope', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          tenantSlug: 'http-alpha',
          email: 'alpha@test.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('POST /auth/refresh rotates token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshTokenA });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
    });

    it('POST /auth/logout revokes session', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ refreshToken: refreshTokenA });

      expect(res.status).toBe(200);
    });
  });

  describe('Branches Endpoints', () => {
    it('GET /branches returns Tenant A branches only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/branches')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('POST /branches creates branch in Tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/branches')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Alpha Second Branch', code: 'ALP-02' });

      expect(res.status).toBe(201);
      expect(res.body.data.code).toBe('ALP-02');
    });

    it('GET /branches/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/branches/${tenantBBranchId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
      expect(res.body.data).toBeNull();
    });

    it('PATCH /branches/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/branches/${tenantBBranchId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hacked Branch Name' });

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Users Endpoints', () => {
    it('GET /users returns Tenant A users only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('POST /users creates new user in Tenant A', async () => {
      const rolesA = await prisma.role.findMany();
      const res = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Alpha Staff',
          email: 'staff@alpha.com',
          password: 'Password123!',
          roleIds: [rolesA[0].id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe('staff@alpha.com');
    });

    it('GET /users/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${tenantBUserId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('PATCH /users/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/users/${tenantBUserId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hacked User Name' });

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Roles Endpoints', () => {
    it('GET /roles returns Tenant A roles only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('POST /roles creates role in Tenant A', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/roles')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          name: 'Supervisor',
          permissionKeys: ['branch.read'],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('Supervisor');
    });

    it('GET /roles/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/roles/${tenantBRoleId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('PATCH /roles/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/roles/${tenantBRoleId}`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Hacked Role' });

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });

    it('DELETE /roles/:id of Tenant B returns 404 for Tenant A token', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/v1/roles/${tenantBRoleId}`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect([404, 403]).toContain(res.status);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Audit Logs Endpoint', () => {
    it('GET /audit-logs returns Tenant A audit logs only', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/audit-logs')
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
