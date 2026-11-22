import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { v7 as uuidv7 } from "uuid";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  method?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  ip?: string;
  body?: any;
  error?: any;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "oldpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "pin",
  "authorization",
  "cookie",
  "key",
]);

/**
 * Masks a phone number showing only the last 3 digits.
 * e.g. "+8801711223344" -> "+88017*****344"
 */
export function maskPhoneNumber(phone: string): string {
  if (!phone || typeof phone !== "string") return phone;
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return "****";
  const visible = trimmed.slice(-3);
  const prefixLen = trimmed.startsWith("+") ? 6 : 5;
  const prefix = trimmed.slice(0, prefixLen);
  return `${prefix}*****${visible}`;
}

/**
 * Deeply sanitizes and masks sensitive fields, tokens, PINs, passwords, and phones.
 */
export function sanitizeLogData(data: any): any {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    // Check if string contains a phone number
    return data.replace(/(?:\+?880|0)1[3-9]\d{8}/g, (match) => maskPhoneNumber(match));
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeLogData(item));
  }

  if (typeof data === "object") {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        cleaned[key] = "[REDACTED]";
      } else if (lowerKey.includes("phone") || lowerKey.includes("mobile")) {
        cleaned[key] = typeof value === "string" ? maskPhoneNumber(value) : sanitizeLogData(value);
      } else {
        cleaned[key] = sanitizeLogData(value);
      }
    }
    return cleaned;
  }

  return data;
}

/**
 * Formats a log entry into a single structured JSON line.
 */
export function formatJsonLog(entry: LogEntry): string {
  const sanitized = sanitizeLogData(entry);
  return JSON.stringify(sanitized);
}

@Injectable()
export class JsonLoggingMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const startTime = Date.now();
    const requestId = (req.headers["x-request-id"] as string) || uuidv7();
    res.setHeader("X-Request-Id", requestId);

    const isAuthRoute =
      req.originalUrl.includes("/auth/login") ||
      req.originalUrl.includes("/auth/signup") ||
      req.originalUrl.includes("/auth/pin") ||
      req.originalUrl.includes("/auth/refresh");

    res.on("finish", () => {
      const durationMs = Date.now() - startTime;
      const user = (req as any).user;
      const tenantId = user?.tenantId || (req.headers["x-tenant-id"] as string);
      const userId = user?.sub || user?.userId || user?.id;

      const logEntry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info",
        message: `${req.method} ${req.originalUrl} ${res.statusCode}`,
        requestId,
        tenantId,
        userId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
        ip: req.ip || req.socket.remoteAddress,
        body: isAuthRoute ? "[AUTH_BODY_REDACTED]" : sanitizeLogData(req.body),
      };

      const line = formatJsonLog(logEntry);
      if (res.statusCode >= 500) {
        console.error(line);
      } else if (res.statusCode >= 400) {
        console.warn(line);
      } else {
        console.log(line);
      }
    });

    next();
  }
}
