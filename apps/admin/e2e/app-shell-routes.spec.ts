import { test, expect } from "@playwright/test";

test.describe("Part A Item 6: Shared AppShell Layout across all admin routes", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  });

  const routes = [
    "/dashboard",
    "/sales",
    "/shifts",
    "/registers",
    "/customers",
    "/catalog/products",
    "/catalog/categories",
    "/inventory/stock",
    "/inventory/adjustments",
    "/inventory/low-stock",
    "/inventory/opening",
    "/purchasing/suppliers",
    "/purchasing/orders",
    "/purchasing/receipts",
    "/reports/sales",
    "/reports/stock",
    "/reports/profit",
    "/settings/shop",
    "/settings/branches",
    "/settings/roles",
    "/settings/users",
    "/settings/audit",
  ];

  for (const route of routes) {
    test(`renders header and sidebar navigation on ${route}`, async ({ page }) => {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");

      // Verify sidebar is present and has navigation links
      const sidebarNav = page.locator("aside nav, nav").first();
      await expect(sidebarNav).toBeVisible({ timeout: 10000 });
      await expect(page.locator('a[href="/dashboard"]').first()).toBeVisible();
      await expect(page.locator('a[href="/sales"]').first()).toBeVisible();

      // Verify header is present
      const header = page.locator("header").first();
      await expect(header).toBeVisible();
    });
  }
});
