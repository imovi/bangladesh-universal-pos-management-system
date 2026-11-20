import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Phase 1E: Mandatory Visual Artifacts & Screenshots (e2, e3, e4)", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const dirE2 = path.resolve(repoRoot, "docs/screenshots/e2");
  const dirE3 = path.resolve(repoRoot, "docs/screenshots/e3");
  const dirE4 = path.resolve(repoRoot, "docs/screenshots/e4");

  test.beforeAll(() => {
    for (const d of [dirE2, dirE3, dirE4]) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
      }
    }
  });

  test("captures all required screenshots for e2, e3, and e4 across viewports", async ({
    page,
    request,
  }) => {
    test.setTimeout(120000);

    // 1. Authenticate with API as Owner
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBeTruthy();
    const loginData = await loginRes.json();
    const token = loginData.data.accessToken;

    // 2. Log in via UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // ----------------------------------------------------
    // E2 Screenshot: Promotion Form with Preview
    // ----------------------------------------------------
    await page.goto("http://localhost:3000/promotions/new");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(600);

    // Desktop 1440px
    await page.screenshot({
      path: path.join(dirE2, "01-promotion-form-preview-desktop.png"),
      fullPage: false,
    });

    // Mobile 375px
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(dirE2, "01-promotion-form-preview-mobile.png"),
      fullPage: false,
    });

    // ----------------------------------------------------
    // E2 & E3 Screenshot: POS with Promotion Badges & Coupon Field
    // ----------------------------------------------------
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(600);

    // Click first product card if available
    const productCard = page.locator('[data-testid="product-grid"] button, [data-testid="pos-product-card"]').first();
    if (await productCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await productCard.click();
      await page.waitForTimeout(300);
    }

    // POS Desktop Light Mode
    await page.screenshot({
      path: path.join(dirE2, "02-pos-promotion-badges-desktop.png"),
      fullPage: false,
    });

    // POS Desktop Dark Mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(dirE2, "02-pos-promotion-badges-dark.png"),
      fullPage: false,
    });
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
    });

    // POS Mobile Light Mode (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(dirE2, "02-pos-promotion-badges-mobile.png"),
      fullPage: false,
    });

    // E3 Coupon Field - Desktop (1440px)
    await page.setViewportSize({ width: 1440, height: 900 });
    const couponInput = page.locator('[data-testid="pos-coupon-input"], input[placeholder*="কুপন"], input[placeholder*="Coupon"]').first();
    if (await couponInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Invalid Coupon test
      await couponInput.fill("INVALID_CODE_999");
      const applyBtn = page.locator('[data-testid="pos-apply-coupon-btn"], button:has-text("প্রয়োগ"), button:has-text("Apply")').first();
      if (await applyBtn.isVisible().catch(() => false)) {
        await applyBtn.click();
        await page.waitForTimeout(500);
      }
      await page.screenshot({
        path: path.join(dirE3, "01-coupon-invalid-desktop.png"),
        fullPage: false,
      });

      // Mobile
      await page.setViewportSize({ width: 375, height: 667 });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(dirE3, "01-coupon-invalid-mobile.png"),
        fullPage: false,
      });
    }

    // ----------------------------------------------------
    // E4 Screenshot: Customer Detail & Loyalty Ledger
    // ----------------------------------------------------
    // Fetch customers
    const custRes = await request.get("http://localhost:4000/api/v1/customers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (custRes.ok()) {
      const custData = await custRes.json();
      const firstCust = custData.data?.items?.[0] || custData.data?.[0];
      if (firstCust) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(`http://localhost:3000/customers/${firstCust.id}`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(500);

        // Desktop Customer Ledger
        await page.screenshot({
          path: path.join(dirE4, "01-customer-ledger-desktop.png"),
          fullPage: false,
        });

        // Mobile Customer Ledger
        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(dirE4, "01-customer-ledger-mobile.png"),
          fullPage: false,
        });
      }
    }

    // ----------------------------------------------------
    // E4 Screenshot: Receipts (80mm and 58mm)
    // ----------------------------------------------------
    // Go to /sales and click first sale if available
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/sales");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);

    const firstSaleRow = page.locator('table tbody tr').first();
    if (await firstSaleRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      await firstSaleRow.click();
      await page.waitForTimeout(500);

      // Receipt 80mm
      await page.setViewportSize({ width: 800, height: 1000 });
      await page.screenshot({
        path: path.join(dirE4, "02-receipt-80mm.png"),
        fullPage: false,
      });

      // Receipt 58mm
      await page.setViewportSize({ width: 450, height: 900 });
      await page.screenshot({
        path: path.join(dirE4, "03-receipt-58mm.png"),
        fullPage: false,
      });
    }
  });
});
