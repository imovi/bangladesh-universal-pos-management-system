import { test, expect } from "@playwright/test";

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
  "/settings",
  "/settings/shop",
  "/settings/branches",
  "/settings/roles",
  "/settings/users",
  "/settings/audit",
  "/pos",
  "/sales/returns",
  "/sales/offline-review",
  "/promotions",
  "/promotions/new",
  "/reports/due",
  "/reports/returns",
  "/reports/damaged",
  "/reports/promotions",
  "/reports/loyalty",
];

test.describe("Global Data Integrity Guard: No NaN, undefined, null, Invalid Date, or [object Object]", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  });

  for (const locale of ["bn", "en"] as const) {
    for (const route of routes) {
      test(`verifies data integrity on ${route} (${locale.toUpperCase()})`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState("domcontentloaded");

        // Switch language if needed
        if (locale === "en") {
          const enBtn = page.locator('header button:has-text("EN"), button:has-text("EN")').first();
          if (await enBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await enBtn.click();
            await page.waitForTimeout(300);
          }
        }

        // Wait for any loading spinners or "লোড হচ্ছে..." / "Loading..." text to disappear
        const loadingIndicator = page.locator('text="লোড হচ্ছে...", text="খোঁজা হচ্ছে...", text="Loading..."').first();
        if (await loadingIndicator.isVisible({ timeout: 1000 }).catch(() => false)) {
          await loadingIndicator.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
        }

        await page.waitForTimeout(400);

        // Fetch all visible text on the page
        const bodyText = await page.locator("body").innerText();

        // 1. Check for NaN
        expect(bodyText).not.toMatch(/\bNaN\b/);

        // 2. Check for undefined
        expect(bodyText).not.toMatch(/\bundefined\b/);

        // 3. Check for standalone null
        expect(bodyText).not.toMatch(/\bnull\b/);

        // 4. Check for Invalid Date
        expect(bodyText).not.toContain("Invalid Date");

        // 5. Check for [object Object]
        expect(bodyText).not.toContain("[object Object]");
      });
    }

    test(`verifies return detail and sale with return pages (${locale.toUpperCase()})`, async ({ page }) => {
      await page.goto("/sales/returns");
      await page.waitForLoadState("domcontentloaded");

      if (locale === "en") {
        const enBtn = page.locator('header button:has-text("EN"), button:has-text("EN")').first();
        if (await enBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await enBtn.click();
          await page.waitForTimeout(300);
        }
      }

      // Check if any return link exists
      const returnRowLink = page.locator('tbody tr a[href*="/sales/returns/"]').first();
      if (await returnRowLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await returnRowLink.click();
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(500);

        let bodyText = await page.locator("body").innerText();
        expect(bodyText).not.toMatch(/\bNaN\b/);
        expect(bodyText).not.toMatch(/\bundefined\b/);
        expect(bodyText).not.toMatch(/\bnull\b/);
        expect(bodyText).not.toContain("Invalid Date");
        expect(bodyText).not.toContain("[object Object]");

        // Click into the associated sale detail
        const saleLink = page.locator('a[href*="/sales/"]:not([href*="/returns/"])').first();
        if (await saleLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await saleLink.click();
          await page.waitForLoadState("domcontentloaded");
          await page.waitForTimeout(500);

          bodyText = await page.locator("body").innerText();
          expect(bodyText).not.toMatch(/\bNaN\b/);
          expect(bodyText).not.toMatch(/\bundefined\b/);
          expect(bodyText).not.toMatch(/\bnull\b/);
          expect(bodyText).not.toContain("Invalid Date");
          expect(bodyText).not.toContain("[object Object]");
        }
      }
    });
  }
});
