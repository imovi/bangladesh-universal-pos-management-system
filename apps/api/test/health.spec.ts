import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { HealthController } from "../src/modules/health.controller.js";

describe("HealthController", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  const mockPrisma = {
    $queryRaw: vi.fn().mockResolvedValue([{ current_database: "universal_pos_test" }]),
  } as any;

  it("does not return databaseName when NODE_ENV is production", async () => {
    process.env.NODE_ENV = "production";
    const controller = new HealthController(mockPrisma);
    const result = await controller.check();

    expect(result.status).toBe("ok");
    expect(result.database).toBe("connected");
    expect(result).not.toHaveProperty("databaseName");
    expect((result as any).databaseName).toBeUndefined();
  });

  it("returns databaseName when NODE_ENV is not production (e.g. development or test)", async () => {
    process.env.NODE_ENV = "test";
    const controller = new HealthController(mockPrisma);
    const result = await controller.check();

    expect(result.status).toBe("ok");
    expect(result.database).toBe("connected");
    expect(result.databaseName).toBe("universal_pos_test");
  });
});
