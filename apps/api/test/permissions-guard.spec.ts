import { describe, it, expect, vi } from "vitest";
import { Reflector } from "@nestjs/core";
import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { PermissionsGuard } from "../src/common/guards/permissions.guard.js";
import { PERMISSIONS, SYSTEM_ROLES } from "@universal-pos/shared";

describe("PermissionsGuard", () => {
  const reflector = new Reflector();
  const guard = new PermissionsGuard(reflector);

  function createMockContext(
    user?: any,
    requiredPermissions?: string[],
  ): ExecutionContext {
    vi.spyOn(reflector, "getAllAndOverride").mockReturnValue(
      requiredPermissions,
    );

    return {
      getHandler: vi.fn(),
      getClass: vi.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it("allows access if no permissions are required", () => {
    const ctx = createMockContext({ id: "user-1" }, undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows access for Owner with wildcard permissions", () => {
    const ctx = createMockContext(
      {
        sub: "user-owner",
        isOwner: true,
        roles: [SYSTEM_ROLES.OWNER],
        permissions: ["*"],
      },
      [PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows access if user holds the exact required permission", () => {
    const ctx = createMockContext(
      {
        sub: "user-manager",
        isOwner: false,
        roles: [SYSTEM_ROLES.MANAGER],
        permissions: [PERMISSIONS.BRANCH_READ, PERMISSIONS.USER_READ],
      },
      [PERMISSIONS.BRANCH_READ],
    );
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("throws ForbiddenException (403) if user lacks the required permission", () => {
    const ctx = createMockContext(
      {
        sub: "user-cashier",
        isOwner: false,
        roles: [SYSTEM_ROLES.CASHIER],
        permissions: [PERMISSIONS.SALE_CREATE],
      },
      [PERMISSIONS.USER_MANAGE],
    );

    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
