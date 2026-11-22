import { describe, it, expect, vi } from "vitest";
import {
  maskPhoneNumber,
  sanitizeLogData,
  formatJsonLog,
  JsonLoggingMiddleware,
  LogEntry,
} from "../src/common/logging/json-logger.js";

describe("Milestone F5: Structured JSON Logger & Sensitive Data Scrubbing", () => {
  it("masks phone numbers showing only the last 3 digits", () => {
    expect(maskPhoneNumber("+8801711223344")).toBe("+88017*****344");
    expect(maskPhoneNumber("01712345678")).toBe("01712*****678");
  });

  it("redacts passwords, tokens, secrets, and PINs in log payloads", () => {
    const raw = {
      email: "user@shop.com",
      password: "SuperSecretPassword123!",
      pin: "1234",
      token: "jwt-token-string",
      refreshToken: "refresh-secret-jwt",
      phone: "+8801711223344",
      meta: {
        nestedPassword: "[SECRET]",
        customerMobile: "01711998877",
      },
    };

    const sanitized = sanitizeLogData(raw);

    expect(sanitized.password).toBe("[REDACTED]");
    expect(sanitized.pin).toBe("[REDACTED]");
    expect(sanitized.token).toBe("[REDACTED]");
    expect(sanitized.refreshToken).toBe("[REDACTED]");
    expect(sanitized.phone).toBe("+88017*****344");
    expect(sanitized.meta.customerMobile).toBe("01711*****877");
  });

  it("produces valid single-line JSON with requestId, tenantId, and userId", () => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info",
      message: "POST /api/v1/sales 201",
      requestId: "req-12345",
      tenantId: "tenant-abc",
      userId: "user-xyz",
      method: "POST",
      url: "/api/v1/sales",
      statusCode: 201,
      durationMs: 45,
      body: {
        totalMinor: 250000,
        customerPhone: "+8801700112233",
      },
    };

    const formatted = formatJsonLog(entry);
    const parsed = JSON.parse(formatted);

    expect(parsed.requestId).toBe("req-12345");
    expect(parsed.tenantId).toBe("tenant-abc");
    expect(parsed.userId).toBe("user-xyz");
    expect(parsed.body.customerPhone).toBe("+88017*****233");
  });

  it("strictly redacts request bodies of auth routes and ensures password never appears", () => {
    const middleware = new JsonLoggingMiddleware();

    const loggedLines: string[] = [];
    const consoleSpy = vi.spyOn(console, "log").mockImplementation((line) => {
      loggedLines.push(line);
    });

    const listeners: Record<string, Function> = {};
    const req: any = {
      method: "POST",
      originalUrl: "/api/v1/auth/login",
      headers: { "x-request-id": "auth-req-999" },
      body: {
        email: "cashier@outlet.com",
        password: "MySecretPasswordNeverLeaked!99",
      },
      ip: "127.0.0.1",
    };

    const headersSent: Record<string, string> = {};
    const res: any = {
      statusCode: 200,
      setHeader: (k: string, v: string) => {
        headersSent[k] = v;
      },
      on: (event: string, cb: Function) => {
        listeners[event] = cb;
      },
    };

    let nextCalled = false;
    middleware.use(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(headersSent["X-Request-Id"]).toBe("auth-req-999");

    // Trigger finish event
    listeners["finish"]();

    expect(loggedLines.length).toBe(1);
    const logOutput = loggedLines[0];

    // CRITICAL: The plain text password must NEVER appear in the log output
    expect(logOutput).not.toContain("MySecretPasswordNeverLeaked!99");
    expect(logOutput).toContain("[AUTH_BODY_REDACTED]");

    consoleSpy.mockRestore();
  });
});
