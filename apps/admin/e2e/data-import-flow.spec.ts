import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

test.describe("Milestone F4: Day-One CSV Import E2E Flow", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("uploads product and opening stock CSV, previews, commits, and verifies product & stock on /pos", async ({
    page,
  }) => {
    const uniqueSuffix = Date.now().toString().slice(-4);
    const sku = `IMP-SKU-${uniqueSuffix}`;
    const barcode = `89099${uniqueSuffix.padStart(7, "0")}`;
    const productName = `ইমপোর্ট সিল্ক পাঞ্জাবি ${uniqueSuffix}`;

    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate to /settings/import
    await page.goto("/settings/import");
    await page.waitForSelector("h1:has-text('ডেটা আমদানি')", { timeout: 10000 });

    // 3. Step 1: Import Product with Variant
    const tempDir = path.resolve(process.cwd(), "temp-import-test");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const productCsvPath = path.join(tempDir, `products-${uniqueSuffix}.csv`);
    const productCsvContent =
      "\uFEFFproduct_name,category,brand,collection,size,colour,sku,barcode,sale_price,cost_price,vat_rate\r\n" +
      `${productName},পাঞ্জাবি,আড়ং,ঈদ কালেকশন,L,সাদা,${sku},${barcode},"2,500.00","1,600",7.5\r\n`;

    fs.writeFileSync(productCsvPath, productCsvContent, "utf-8");

    // Upload product CSV
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(productCsvPath);

    // Click Preview
    const previewBtn = page.locator('button:has-text("যাচাই করুন (প্রিভিউ)")');
    await previewBtn.click();

    // Verify preview results (1 total row, 1 valid row, 0 error rows)
    await page.waitForSelector("text=মোট লাইন: 1", { timeout: 10000 });
    await expect(page.locator("text=সঠিক লাইন: 1")).toBeVisible();

    // Click Commit
    const commitBtn = page.locator('button:has-text("আমদানি নিশ্চিত করুন")');
    await commitBtn.click();

    // Verify success banner
    await page.waitForSelector("text=সফলভাবে", { timeout: 15000 });

    // 4. Step 2: Import Opening Stock for this variant
    // Switch to stock tab
    const stockTabBtn = page.locator('button:has-text("প্রারম্ভিক মজুদ")').first();
    await stockTabBtn.click();

    const stockCsvPath = path.join(tempDir, `stock-${uniqueSuffix}.csv`);
    const stockCsvContent =
      "sku,branch_code,quantity,unit_cost\r\n" +
      `${sku},GFS-01,88,1600\r\n`;

    fs.writeFileSync(stockCsvPath, stockCsvContent, "utf-8");

    // Upload stock CSV
    await fileInput.setInputFiles(stockCsvPath);

    // Preview
    await previewBtn.click();
    await page.waitForSelector("text=মোট লাইন: 1", { timeout: 10000 });
    await expect(page.locator("text=সঠিক লাইন: 1")).toBeVisible();

    // Commit
    await commitBtn.click();
    await page.waitForSelector("text=সফলভাবে", { timeout: 15000 });

    // 5. Clean up temporary files
    try {
      fs.unlinkSync(productCsvPath);
      fs.unlinkSync(stockCsvPath);
    } catch {}

    // 6. Navigate to /pos and verify the imported product and stock level
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");

    // If active register has another cashier's shift, dismiss by choosing other register
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
    }

    // Ensure shift is open if open-shift dialog appears
    const confirmShiftBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmShiftBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await confirmShiftBtn.click();
      await expect(confirmShiftBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন")');
      if (await openShiftBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await openShiftBtn.click();
        await page.waitForTimeout(300);
        if (await confirmShiftBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await page.fill('[data-testid="opening-cash-input"]', "500");
          await confirmShiftBtn.click();
          await expect(confirmShiftBtn).toBeHidden({ timeout: 5000 });
        }
      }
    }

    // Wait for POS search input to be ready
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 15000 });

    // Search for the newly imported SKU
    await searchInput.fill(sku);
    await page.waitForTimeout(500);

    // Verify product card appears
    const productCard = page.locator(`[data-testid^="product-card-"]`).filter({ hasText: productName });
    await expect(productCard).toBeVisible({ timeout: 10000 });

    // Verify product name and imported opening stock level (88) are displayed on the card
    await expect(productCard).toContainText(productName);
    await expect(productCard).toContainText("88");
  });
});
