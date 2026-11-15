import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db-helper.js";

interface RolePrivilegeRow {
  current_user: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
}

describe("M0: Runtime User Privileges Verification", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("confirms that the runtime database login user is non-superuser, NOINHERIT, and does NOT bypass RLS", async () => {
    const rows = await prisma.$queryRaw<RolePrivilegeRow[]>`
      SELECT 
        current_user::text,
        rolsuper,
        rolbypassrls,
        rolinherit
      FROM pg_roles 
      WHERE rolname = current_user;
    `;

    expect(rows).toHaveLength(1);
    const userRole = rows[0];

    // Assert that runtime connects as pos_runtime
    expect(userRole.current_user).toBe("pos_runtime");

    // Assert rolsuper is false
    expect(userRole.rolsuper).toBe(false);

    // Assert rolbypassrls is false
    expect(userRole.rolbypassrls).toBe(false);

    // Assert rolinherit is false
    expect(userRole.rolinherit).toBe(false);
  });
});
