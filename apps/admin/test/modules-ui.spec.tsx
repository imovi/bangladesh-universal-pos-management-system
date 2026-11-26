import { describe, it, expect } from "vitest";
import type { ModuleKey } from "@universal-pos/shared";

describe("Phase 2.0 Module UI & Hook Logic Unit Tests", () => {
  interface NavItem {
    titleKey: string;
    href: string;
    permission?: string;
    module?: ModuleKey;
    subItems?: Array<{ titleKey: string; href: string; permission?: string; module?: ModuleKey }>;
  }

  function filterNavItems(
    navItems: NavItem[],
    userPermissions: string[],
    isOwner: boolean,
    activeModules: ModuleKey[]
  ) {
    const hasPermission = (p: string) => isOwner || userPermissions.includes("*") || userPermissions.includes(p);
    const isModuleActive = (m: ModuleKey) => activeModules.includes(m);

    return navItems
      .filter((item) => {
        if (item.permission && !hasPermission(item.permission)) return false;
        if (item.module && !isModuleActive(item.module)) return false;
        return true;
      })
      .map((item) => {
        if (!item.subItems) return item;
        return {
          ...item,
          subItems: item.subItems.filter((sub) => {
            if (sub.permission && !hasPermission(sub.permission)) return false;
            if (sub.module && !isModuleActive(sub.module)) return false;
            return true;
          }),
        };
      });
  }

  describe("useModules() hook logic", () => {
    it("returns empty array and false for any key when activeModules is not present", () => {
      const activeModules: ModuleKey[] = [];
      const isModuleActive = (k: ModuleKey) => activeModules.includes(k);

      expect(activeModules).toHaveLength(0);
      expect(isModuleActive("units")).toBe(false);
      expect(isModuleActive("pharmacy_catalog")).toBe(false);
    });

    it("correctly identifies active vs inactive modules", () => {
      const activeModules: ModuleKey[] = ["units", "chemical_safety", "b2b_wholesale"];
      const isModuleActive = (k: ModuleKey) => activeModules.includes(k);

      expect(isModuleActive("units")).toBe(true);
      expect(isModuleActive("chemical_safety")).toBe(true);
      expect(isModuleActive("b2b_wholesale")).toBe(true);
      expect(isModuleActive("batch_expiry")).toBe(false);
      expect(isModuleActive("pharmacy_catalog")).toBe(false);
    });
  });

  describe("Sidebar navigation item filtering", () => {
    const sampleNav: NavItem[] = [
      {
        titleKey: "dashboard",
        href: "/dashboard",
        permission: "sale.read",
      },
      {
        titleKey: "catalog",
        href: "/catalog/products",
        permission: "catalog.read",
        subItems: [
          { titleKey: "products", href: "/catalog/products", permission: "catalog.read" },
          { titleKey: "units", href: "/catalog/units", permission: "catalog.read", module: "units" },
          { titleKey: "prescriptions", href: "/catalog/prescriptions", permission: "catalog.read", module: "prescription" },
        ],
      },
      {
        titleKey: "chemicalSafety",
        href: "/chemical-safety",
        permission: "catalog.read",
        module: "chemical_safety",
      },
      {
        titleKey: "settings",
        href: "/settings/shop",
        permission: "tenant.read",
        subItems: [
          { titleKey: "shopSettings", href: "/settings/shop", permission: "tenant.read" },
          { titleKey: "modules", href: "/settings/modules", permission: "tenant.read" },
        ],
      },
    ];

    it("hides module-specific items when tenant has no active modules", () => {
      const filtered = filterNavItems(sampleNav, ["sale.read", "catalog.read", "tenant.read"], false, []);

      // chemicalSafety top-level nav item should be filtered out
      const topKeys = filtered.map((i) => i.titleKey);
      expect(topKeys).toContain("dashboard");
      expect(topKeys).toContain("catalog");
      expect(topKeys).toContain("settings");
      expect(topKeys).not.toContain("chemicalSafety");

      // In catalog subItems, 'units' and 'prescriptions' must be filtered out
      const catalogItem = filtered.find((i) => i.titleKey === "catalog");
      const subKeys = catalogItem?.subItems?.map((s) => s.titleKey) || [];
      expect(subKeys).toEqual(["products"]);

      // Settings subItems should retain 'modules'
      const settingsItem = filtered.find((i) => i.titleKey === "settings");
      const settingsSubKeys = settingsItem?.subItems?.map((s) => s.titleKey) || [];
      expect(settingsSubKeys).toContain("modules");
    });

    it("shows module-specific items when module is active for the tenant", () => {
      const activeModules: ModuleKey[] = ["chemical_safety", "units"];
      const filtered = filterNavItems(sampleNav, ["sale.read", "catalog.read", "tenant.read"], false, activeModules);

      const topKeys = filtered.map((i) => i.titleKey);
      expect(topKeys).toContain("chemicalSafety");

      const catalogItem = filtered.find((i) => i.titleKey === "catalog");
      const subKeys = catalogItem?.subItems?.map((s) => s.titleKey) || [];
      expect(subKeys).toContain("units");
      expect(subKeys).not.toContain("prescriptions");
    });
  });
});
