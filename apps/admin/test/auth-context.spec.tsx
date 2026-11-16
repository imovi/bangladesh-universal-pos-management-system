import { describe, it, expect } from "vitest";

describe("Auth Permission Helper Logic", () => {
  function checkPermission(
    user: { isOwner: boolean; permissions: string[] } | null,
    permission: string
  ): boolean {
    if (!user) return false;
    if (user.isOwner) return true;
    if (user.permissions.includes("*")) return true;
    return user.permissions.includes(permission);
  }

  it("grants access to any permission for system owner", () => {
    const owner = { isOwner: true, permissions: [] };
    expect(checkPermission(owner, "products.create")).toBe(true);
    expect(checkPermission(owner, "settings.update")).toBe(true);
    expect(checkPermission(owner, "reports.profit")).toBe(true);
  });

  it("grants access when wildcard permission is present", () => {
    const superAdmin = { isOwner: false, permissions: ["*"] };
    expect(checkPermission(superAdmin, "users.read")).toBe(true);
  });

  it("grants access only to explicitly permitted keys for standard staff", () => {
    const cashier = {
      isOwner: false,
      permissions: ["sales.create", "sales.read", "customers.read"],
    };
    expect(checkPermission(cashier, "sales.create")).toBe(true);
    expect(checkPermission(cashier, "sales.read")).toBe(true);
    expect(checkPermission(cashier, "inventory.adjust")).toBe(false);
    expect(checkPermission(cashier, "tenant.update")).toBe(false);
  });

  it("denies access when user is null", () => {
    expect(checkPermission(null, "sales.read")).toBe(false);
  });
});
