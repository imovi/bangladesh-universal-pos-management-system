import { test, expect } from "@playwright/test";
import path from "path";

const SCREENSHOT_DIR = path.resolve(process.cwd(), "../../docs/screenshots/a2");

test.describe("Milestone A2: Sign-in, Session, and App Shell E2E", () => {
  test("shows clear error for invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "WrongPassword123!");
    await page.click('button[type="submit"]');

    const alert = page.locator('[data-testid="error-alert"]');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("ভুল দোকান কোড");
  });

  test("signs in as Owner, verifies app shell, captures screenshots, and logs out", async ({
    page,
  }) => {
    // 1. Visit Login Page at Desktop Viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    await expect(page.locator("h3")).toContainText("দোকানের ব্যাক অফিসে লগইন");

    // Capture Desktop Light Login
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-light-login.png"),
      fullPage: true,
    });

    // Toggle to Dark Mode on Login
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-dark-login.png"),
      fullPage: true,
    });

    // Toggle back to Light Mode
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);

    // 2. Perform Login as Owner
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    // Wait for redirect to /dashboard
    await page.waitForURL("**/dashboard", { timeout: 15000 });
    await expect(page.locator("h1")).toContainText("ড্যাশবোর্ড");

    // Capture Desktop Light Shell (Dashboard)
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-light-shell.png"),
      fullPage: true,
    });

    // Toggle Dark Mode in Dashboard
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-dark-shell.png"),
      fullPage: true,
    });

    // Toggle back to Light
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);

    // 3. Visit List Screen (Products Catalog)
    await page.goto("/catalog/products");
    await expect(page.locator("h1")).toContainText("পণ্য ব্যবস্থাপনা");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-light-list.png"),
      fullPage: true,
    });

    // 4. Visit Form Screen (Shop Settings)
    await page.goto("/settings/shop");
    await expect(page.locator("h1")).toContainText("দোকানের সেটিংস");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "desktop-light-form.png"),
      fullPage: true,
    });

    // 5. Test Language Switcher
    await page.locator('[data-testid="language-toggle"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1")).toContainText("Shop Settings");
    // Switch back to Bangla
    await page.locator('[data-testid="language-toggle"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator("h1")).toContainText("দোকানের সেটিংস");

    // 6. Sign Out
    await page.locator('[data-testid="user-menu-button"]').click();
    await page.waitForTimeout(300);
    await page.locator('[data-testid="logout-button"]').click();
    await page.waitForURL("**/login", { timeout: 10000 });
    await expect(page.locator("h3")).toContainText("দোকানের ব্যাক অফিসে লগইন");
  });

  test("mobile viewport (375px) renders drawer shell and responsive layout", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 });

    // Login page mobile
    await page.goto("/login");
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "mobile-light-login.png"),
      fullPage: true,
    });

    // Dark mode mobile login
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "mobile-dark-login.png"),
      fullPage: true,
    });
    await page.locator('[data-testid="theme-toggle"]').click();

    // Login as owner on mobile
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Capture Mobile Light Shell
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "mobile-light-shell.png"),
      fullPage: true,
    });

    // Toggle dark mode on mobile header
    await page.locator('[data-testid="theme-toggle"]').click();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "mobile-dark-shell.png"),
      fullPage: true,
    });

    // Open mobile drawer
    await page.locator('[data-testid="mobile-menu-button"]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('.fixed nav[aria-label="Main Navigation"]')).toBeVisible();
  });

  test("cashier role cannot see manager/owner settings or purchasing navigation", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");

    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "cashier@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Cashier should see Sales
    const nav = page.locator('nav[aria-label="Main Navigation"]');
    await expect(nav.getByText("বিক্রি ও কাউন্টার")).toBeVisible();

    // Cashier should NOT see Settings or Purchasing or Adjustments
    await expect(nav.getByText("সেটিংস")).not.toBeVisible();
    await expect(nav.getByText("ক্রয় ও সরবরাহকারী")).not.toBeVisible();
  });
});
