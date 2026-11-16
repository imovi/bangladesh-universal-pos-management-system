import { test, expect } from "@playwright/test";

test.describe("Milestone A7: Dashboard & Reports Flow", () => {
  test.beforeEach(async ({ page }) => {
    page.on("pageerror", (err) => console.error("BROWSER_PAGE_ERROR:", err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.error("BROWSER_CONSOLE_ERROR:", msg.text());
    });

    // Sign in as Owner using reliable IDs
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    // Wait for redirect to dashboard
    await page.waitForURL("**/dashboard", { timeout: 15000 });
  });

  test("Dashboard displays key metrics and responsive layout at 375px", async ({ page }) => {
    // Verify top KPI elements exist
    await expect(page.locator('[data-testid="dashboard-total-sales"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="dashboard-sales-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-avg-sale"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-low-stock-count"]')).toBeVisible();
    await expect(page.locator('[data-testid="dashboard-open-shifts-count"]')).toBeVisible();

    // Responsive check at 375px mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page.locator('[data-testid="dashboard-total-sales"]')).toBeVisible();
    await expect(page.locator("text=Payment Method Breakdown").or(page.locator("text=পেমেন্ট মাধ্যম বিশ্লেষণ"))).toBeVisible();
  });

  test("Sales Reports: navigation across tabs, filters and variant matrix", async ({ page }) => {
    await page.goto("/reports/sales");

    // Check Overview / Summary Tab
    await expect(page.locator("text=Overview").or(page.locator("text=সারসংক্ষেপ"))).toBeVisible({ timeout: 10000 });

    // Click By Product & Variant Tab
    await page.click('button:has-text("By Product & Variant"), button:has-text("পণ্য ও ভ্যারিয়েন্ট ভিত্তিক")');
    await expect(page.locator("table")).toBeVisible();

    // Click By Category Tab
    await page.click('button:has-text("By Category"), button:has-text("ক্যাটাগরি ভিত্তিক")');
    await expect(page.locator("table")).toBeVisible();

    // Click By Brand Tab
    await page.click('button:has-text("By Brand"), button:has-text("ব্র্যান্ড ভিত্তিক")');
    await expect(page.locator("table")).toBeVisible();

    // Click Variant Matrix Tab
    await page.click('button:has-text("Size & Colour Grid"), button:has-text("সাইজ ও কালার গ্রিড")');
    const select = page.locator('select[aria-label="Select product for matrix"]');
    await expect(select).toBeVisible();

    // If products exist in dropdown, select one and verify matrix renders
    const options = await select.locator("option").all();
    if (options.length > 1) {
      const val = await options[1].getAttribute("value");
      if (val) {
        await select.selectOption(val);
        await expect(page.locator("table")).toBeVisible();
      }
    }
  });

  test("Stock Valuation: displays inventory valuation and items", async ({ page }) => {
    await page.goto("/reports/stock");
    await expect(page.locator("h1")).toContainText(/Stock Valuation|স্টক মূল্যায়ন/, { timeout: 10000 });
    await expect(page.locator("text=Cost Basis").or(page.locator("text=ক্রয়মূল্য")).first()).toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });

  test("Profit & Loss: owner can view, cashier is access-denied", async ({ page, context }) => {
    // 1. Owner can view profit report
    await page.goto("/reports/profit");
    await expect(page.locator('[data-testid="profit-revenue"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="profit-cogs"]')).toBeVisible();
    await expect(page.locator('[data-testid="profit-gross-profit"]')).toBeVisible();
    await expect(page.locator('[data-testid="profit-margin"]')).toBeVisible();

    // 2. Clear cookies/storage and sign in as Cashier
    await context.clearCookies();
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "cashier@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 3. Attempt to access /reports/profit directly
    await page.goto("/reports/profit");
    // Assert permission denied message is displayed
    await expect(
      page.locator("text=Access Denied").or(page.locator("text=প্রবেশাধিকার নেই")),
    ).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-testid="profit-revenue"]')).not.toBeVisible();
  });
});
