import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { envSchema } from '../src/common/config/config.service.js';

describe('Fix 6: CORS Configuration & Security', () => {
  it('parses comma-separated CORS_ORIGINS into an array of allowed origins in development', () => {
    const validDev = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost:5432/db',
      JWT_ACCESS_SECRET: 'a-long-enough-jwt-access-secret-key-32',
      JWT_REFRESH_SECRET: 'a-long-enough-jwt-refresh-secret-key-32',
      CORS_ORIGINS: 'http://localhost:3000, https://admin.pos.com',
    };

    const parsed = envSchema.safeParse(validDev);
    expect(parsed.success).toBe(true);
  });

  it('refuses to start in production if CORS_ORIGINS contains wildcard (*)', () => {
    const invalidProd = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/db',
      JWT_ACCESS_SECRET: 'a-long-enough-jwt-access-secret-key-32',
      JWT_REFRESH_SECRET: 'a-long-enough-jwt-refresh-secret-key-32',
      CORS_ORIGINS: 'https://admin.pos.com, *',
    };

    const parsed = envSchema.safeParse(invalidProd);
    expect(parsed.success).toBe(false);
  });

  it('refuses to start in production if CORS_ORIGINS is empty', () => {
    const emptyProd = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost:5432/db',
      JWT_ACCESS_SECRET: 'a-long-enough-jwt-access-secret-key-32',
      JWT_REFRESH_SECRET: 'a-long-enough-jwt-refresh-secret-key-32',
      CORS_ORIGINS: '',
    };

    const parsed = envSchema.safeParse(emptyProd);
    expect(parsed.success).toBe(false);
  });
});
