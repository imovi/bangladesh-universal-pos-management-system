import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../common/database/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

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
