import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter.js';

describe('Fix 5: Rate Limiting Verification', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new TransformInterceptor());
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('exceeding rate limit on POST /auth/login returns 429 with standard error envelope', async () => {
    const loginPayload = {
      tenantSlug: 'non-existent',
      email: 'brute@force.com',
      password: 'Password123!',
    };

    // Make 5 requests (within the limit of 5 per minute)
    for (let i = 0; i < 5; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send(loginPayload);
      expect(res.status).not.toBe(429);
    }

    // 6th request must be throttled with HTTP 429
    const throttledRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send(loginPayload);

    expect(throttledRes.status).toBe(429);
    expect(throttledRes.body.success).toBe(false);
    expect(throttledRes.body.data).toBeNull();
    expect(throttledRes.body.error).toBeDefined();
    expect(throttledRes.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(throttledRes.body.meta.timestamp).toBeDefined();
  });
});
