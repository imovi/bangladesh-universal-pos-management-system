import { describe, it, expect, vi } from "vitest";
import { TransformInterceptor } from "../src/common/interceptors/transform.interceptor.js";
import { HttpExceptionFilter } from "../src/common/filters/http-exception.filter.js";
import { JwtAuthGuard } from "../src/common/guards/jwt-auth.guard.js";
import { of, firstValueFrom } from "rxjs";
import {
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from "@nestjs/common";
import { ZodError } from "zod";

describe("Common Filters & Interceptors", () => {
  describe("TransformInterceptor", () => {
    const interceptor = new TransformInterceptor();

    it("wraps simple response into API envelope", async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { "x-request-id": "req-123" } }),
        }),
      } as any;

      const callHandler = {
        handle: () => of({ test: "data" }),
      };

      const result = await firstValueFrom(
        interceptor.intercept(mockContext, callHandler),
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ test: "data" });
      expect(result.error).toBeNull();
      expect(result.meta.requestId).toBe("req-123");
    });

    it("extracts pagination when present in response object", async () => {
      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as any;

      const paginatedData = {
        items: [{ id: 1 }, { id: 2 }],
        pagination: { page: 1, limit: 10, total: 2, totalPages: 1 },
      };

      const callHandler = { handle: () => of(paginatedData) };
      const result = await firstValueFrom(
        interceptor.intercept(mockContext, callHandler),
      );

      expect(result.data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(result.meta.pagination).toEqual(paginatedData.pagination);
    });
  });

  describe("HttpExceptionFilter", () => {
    const filter = new HttpExceptionFilter();

    function createMockHost() {
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const req = {
        headers: { "x-request-id": "custom-req-id" },
        socket: {},
      };

      return {
        host: {
          switchToHttp: () => ({
            getResponse: () => res,
            getRequest: () => req,
          }),
        } as any,
        res,
        req,
      };
    }

    it("formats NestJS HttpException into error envelope", () => {
      const { host, res } = createMockHost();
      const exception = new BadRequestException("Invalid payload");

      filter.catch(exception, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          data: null,
          error: expect.objectContaining({
            message: "Invalid payload",
          }),
        }),
      );
    });

    it("formats ZodError into VALIDATION_ERROR envelope with details", () => {
      const { host, res } = createMockHost();
      const zodError = new ZodError([
        {
          code: "invalid_type",
          expected: "string",
          received: "number",
          path: ["email"],
          message: "Expected string, received number",
        },
      ]);

      filter.catch(zodError, host);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
            details: [
              { field: "email", issue: "Expected string, received number" },
            ],
          }),
        }),
      );
    });
  });

  describe("JwtAuthGuard", () => {
    let guard: JwtAuthGuard;
    let mockJwt: any;
    let mockConfig: any;

    beforeEach(() => {
      mockJwt = { verifyAsync: vi.fn() };
      mockConfig = { get: vi.fn().mockReturnValue("mock-secret") };
      guard = new JwtAuthGuard(mockJwt, mockConfig);
    });

    it("throws UnauthorizedException if authorization header is missing", async () => {
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: {} }),
        }),
      } as any;

      await expect(guard.canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it("validates token and attaches user payload to request", async () => {
      const req: any = { headers: { authorization: "Bearer valid.jwt.token" } };
      const ctx = {
        switchToHttp: () => ({
          getRequest: () => req,
        }),
      } as any;

      mockJwt.verifyAsync.mockResolvedValue({
        sub: "user-1",
        tenantId: "tenant-1",
      });

      const allowed = await guard.canActivate(ctx);
      expect(allowed).toBe(true);
      expect(req.user).toEqual({ sub: "user-1", tenantId: "tenant-1" });
    });
  });
});
