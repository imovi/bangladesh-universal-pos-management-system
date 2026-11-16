import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const screenshotsDir = path.resolve(
  process.cwd(),
  process.cwd().endsWith("admin") ? "../../docs/screenshots/design-v2" : "docs/screenshots/design-v2"
);

test.describe("Part B Design Corrections Screenshots", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  async function loginAsOwner(page: any) {
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  }

  test("captures desktop (1440px) screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsOwner(page);

    // 1. Dashboard Bengali
    await page.waitForSelector('[data-testid="dashboard-total-sales"]', { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-dashboard-bn.png"), fullPage: true });

    // 2. Dashboard English
    const langBtn = page.locator('button:has-text("English"), button:has-text("বাংলা")');
    if (await langBtn.isVisible()) {
      await langBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(screenshotsDir, "desktop-dashboard-en.png"), fullPage: true });
      // Switch back to Bengali
      await langBtn.click();
      await page.waitForTimeout(500);
    }

    // 3. Products List
    await page.goto("/catalog/products");
    await page.waitForSelector("table", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-products-list.png"), fullPage: true });

    // 4. New Product Form
    await page.goto("/catalog/products/new");
    await page.waitForSelector("#name", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-product-new.png"), fullPage: true });

    // 5. Product Detail with Matrix
    await page.goto("/catalog/products");
    await page.waitForSelector("table tbody tr", { state: "visible" });
    const firstProduct = page.locator("table tbody tr").first();
    await firstProduct.click();
    await page.waitForURL("**/catalog/products/*", { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-product-detail.png"), fullPage: true });

    // 6. Sales List
    await page.goto("/sales");
    await page.waitForSelector("table", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-sales-list.png"), fullPage: true });

    // 7. Shift Detail
    await page.goto("/shifts");
    await page.waitForSelector("table tbody tr", { state: "visible" });
    const firstShift = page.locator("table tbody tr").first();
    await firstShift.click();
    await page.waitForURL("**/shifts/*", { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-shift-detail.png"), fullPage: true });

    // 8. Stock Valuation Report
    await page.goto("/reports/stock");
    await page.waitForSelector("table", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-stock-valuation.png"), fullPage: true });
  });

  test("captures mobile (375px) screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsOwner(page);

    // 1. Mobile Dashboard
    await page.waitForSelector('[data-testid="dashboard-total-sales"]', { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "mobile-dashboard.png"), fullPage: true });

    // 2. Mobile Sales List
    await page.goto("/sales");
    await page.waitForSelector("table", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "mobile-sales-list.png"), fullPage: true });

    // 3. Mobile New Product Form
    await page.goto("/catalog/products/new");
    await page.waitForSelector("#name", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "mobile-product-new.png"), fullPage: true });
  });

  test("captures dark theme (1440px) screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAsOwner(page);

    // Switch to dark theme
    const themeBtn = page.locator('button[title*="থিম"], button[aria-label*="থিম"], button[title*="Theme"], button[aria-label*="Theme"]');
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(400);
    } else {
      await page.evaluate(() => {
        document.documentElement.classList.add("dark");
      });
      await page.waitForTimeout(400);
    }

    // 1. Dark Dashboard
    await page.goto("/dashboard");
    await page.waitForSelector('[data-testid="dashboard-total-sales"]', { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "dark-dashboard.png"), fullPage: true });

    // 2. Dark Sales List
    await page.goto("/sales");
    await page.waitForSelector("table", { state: "visible" });
    await page.screenshot({ path: path.join(screenshotsDir, "dark-sales-list.png"), fullPage: true });
  });
});
