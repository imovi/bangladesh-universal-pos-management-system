import { Controller, Get, HttpStatus, Res } from "@nestjs/common";
import type { Response } from "express";
import net from "net";
import { PrismaService } from "../common/database/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("live")
  getLive() {
    return {
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async getReady(@Res({ passthrough: true }) res: Response) {
    let dbStatus = "unreachable";
    let migrationsStatus = "unknown";
    let redisStatus = "skipped";
    let isReady = true;

    // 1. Check Database & Migrations
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbStatus = "connected";

      // Check _prisma_migrations table
      const migrationRes = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint as count FROM "_prisma_migrations" WHERE rolled_back_at IS NOT NULL
      `;
      const rolledBackCount = Number(migrationRes[0]?.count ?? 0n);
      if (rolledBackCount > 0) {
        migrationsStatus = "unhealthy_rolled_back";
        isReady = false;
      } else {
        migrationsStatus = "applied";
      }
    } catch {
      dbStatus = "error";
      migrationsStatus = "error";
      isReady = false;
    }

    // 2. Check Redis if REDIS_URL is configured
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const parsed = new URL(redisUrl);
        const host = parsed.hostname || "localhost";
        const port = Number(parsed.port || 6379);

        const redisOk = await new Promise<boolean>((resolve) => {
          const socket = net.createConnection({ host, port, timeout: 2000 }, () => {
            socket.destroy();
            resolve(true);
          });
          socket.on("error", () => {
            socket.destroy();
            resolve(false);
          });
          socket.on("timeout", () => {
            socket.destroy();
            resolve(false);
          });
        });

        if (redisOk) {
          redisStatus = "connected";
        } else {
          redisStatus = "unreachable";
          isReady = false;
        }
      } catch {
        redisStatus = "error";
        isReady = false;
      }
    }

    if (!isReady) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return {
      status: isReady ? "ok" : "degraded",
      database: dbStatus,
      migrations: migrationsStatus,
      redis: redisStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  async check() {
    let dbStatus = "disconnected";
    let dbName = "";
    try {
      const res = await this.prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
      dbStatus = "connected";
      dbName = res[0]?.current_database || "";
    } catch {
      dbStatus = "unreachable";
    }

    const isProduction = process.env.NODE_ENV === "production";

    return {
      status: "ok",
      database: dbStatus,
      ...(isProduction ? {} : { databaseName: dbName }),
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
