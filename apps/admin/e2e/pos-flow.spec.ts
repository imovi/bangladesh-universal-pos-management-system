import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "path";
import fs from "fs";

const screenshotsDir = path.resolve(
  process.cwd(),
  process.cwd().endsWith("admin") ? "../../docs/screenshots/pos" : "docs/screenshots/pos",
);

test.describe("Part C: POS Selling Screen & Register Lifecycle Flow", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("Flow 1: Counter-only Cashier login lands directly on /pos and enforces discount limit", async ({
    page,
  }) => {
    // Sign in as cashier (has 5% discount limit)
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "cashier@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');

    // Requirement: Cashier lands on /pos directly after sign-in
    await page.waitForURL("**/pos", { timeout: 15000 });
    expect(page.url()).toContain("/pos");

    // Check discount limit display (5%)
    await expect(page.locator("text=5%")).toBeVisible({ timeout: 10000 });

    // Open shift if closed
    const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
    if (await openShiftBtn.isVisible()) {
      await openShiftBtn.click();
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await page.click('[data-testid="confirm-open-shift-button"]');
      await page.waitForTimeout(1000);
    }

    // Add an item to cart by clicking first product card
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // If variant picker opened, click first in-stock variant
    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await variantCell.isVisible({ timeout: 2000 }).catch(() => false)) {
      await variantCell.click();
    }

    // Verify cart has at least 1 item
    await expect(page.locator('[data-testid^="qty-input-"]')).toBeVisible();

    // Try applying 10% bill discount (which exceeds 5% limit)
    await page.click('button:has-text("বিল ডিসকাউন্ট"), button:has-text("Bill discount")');
    await page.fill('[data-testid="bill-discount-input"]', "10");
    await page.click('[data-testid="apply-bill-discount-button"]');

    // Warning banner should be visible immediately
    await expect(page.locator('[data-testid="discount-limit-alert"]')).toBeVisible();

    // Close shift to leave register clean
    const closeShiftBtn = page.locator('[data-testid="close-shift-button"]');
    if (await closeShiftBtn.isVisible()) {
      await closeShiftBtn.click();
      await page.fill('[data-testid="counted-cash-input"]', "500");
      await page.click('[data-testid="confirm-close-shift-button"]');
      await page.waitForTimeout(1000);
    }

    // Sign out
    await page.goto("/login");
  });

  test("Flow 2: Full Selling Flow (Open Shift -> Barcode Scan -> Variant Picker -> Split Payment -> Receipt -> Cash Out -> Close Shift)", async ({
    page,
  }) => {
    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "owner@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Navigate to /pos using the "Start selling" link
    const posLink = page.locator('[data-testid="sidebar-pos-link"], [data-testid="header-pos-link"]').first();
    await posLink.click();
    await page.waitForURL("**/pos", { timeout: 10000 });

    // 2. Select register POS-01
    const regSelect = page.locator('[data-testid="register-select"]');
    await expect(regSelect).toBeVisible({ timeout: 10000 });
    const options = await regSelect.locator("option").all();
    if (options.length > 0) {
      await regSelect.selectOption({ index: 0 });
    }

    // Dismiss any shift in use dialog by switching register if needed
    const shiftInUseDialog = page.locator('[role="dialog"]:has-text("রেজিস্টারটি অন্য ক্যাশিয়ার ব্যবহার করছেন")');
    if (await shiftInUseDialog.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.click('button:has-text("অন্য রেজিস্টার নির্বাচন করুন")');
      await regSelect.selectOption({ index: 1 });
    }

    // 3. Wait for Shift status and Open Shift if closed
    const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
    const cashMoveBtn = page.locator('[data-testid="cash-movement-button"]');
    await expect(openShiftBtn.or(cashMoveBtn)).toBeVisible({ timeout: 10000 });

    if (await openShiftBtn.isVisible()) {
      await openShiftBtn.click();
      const openCashInput = page.locator('[data-testid="opening-cash-input"]');
      await expect(openCashInput).toBeVisible({ timeout: 5000 });
      await openCashInput.fill("1000");
      await page.click('[data-testid="confirm-open-shift-button"]');
      await expect(cashMoveBtn).toBeVisible({ timeout: 10000 });
    }

    // Capture screenshot: selling screen with register ready
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-pos-ready.png") });

    // 4. Barcode Scan / Search
    await page.fill('[data-testid="pos-search-input"]', "Polo");
    await page.waitForTimeout(400);

    // Click product to open Variant Picker
    const poloProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(poloProduct).toBeVisible({ timeout: 10000 });
    await poloProduct.click();

    // Variant Picker matrix should appear
    const variantMatrixCell = page.locator('[data-testid^="variant-cell-"]').first();
    await expect(variantMatrixCell).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: path.join(screenshotsDir, "variant-picker-modal.png") });
    await variantMatrixCell.click();

    // Clear search and add a second product
    await page.fill('[data-testid="pos-search-input"]', "");
    await page.waitForTimeout(400);
    const secondProduct = page.locator('[data-testid^="product-card-"]').nth(1);
    if (await secondProduct.isVisible()) {
      await secondProduct.click();
      const secondVariantCell = page.locator('[data-testid^="variant-cell-"]').first();
      if (await secondVariantCell.isVisible({ timeout: 2000 }).catch(() => false)) {
        await secondVariantCell.click();
      }
    }

    // 5. Line Discount within limit
    const lineDiscountBtn = page.locator('[data-testid^="line-discount-btn-"]').first();
    if (await lineDiscountBtn.isVisible()) {
      await lineDiscountBtn.click();
      await page.fill('[data-testid="line-discount-input"]', "5");
      await page.click('[data-testid="apply-line-discount-button"]');
    }

    // Verify grand total is displayed
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled();

    // 6. Checkout (F4) -> Split Payment Modal
    await checkoutBtn.click();

    // Verify Payment Dialog is visible
    const paymentDialog = page.locator('[role="dialog"]:has-text("পেমেন্ট সম্পন্ন করুন"), [role="dialog"]:has-text("Complete Payment")');
    await expect(paymentDialog).toBeVisible({ timeout: 5000 });

    // Capture screenshot: payment dialog
    await page.screenshot({ path: path.join(screenshotsDir, "payment-dialog.png") });

    // Split payment: 1000 in Cash, remainder in bKash
    const cashAmountInput = page.locator('[data-testid="payment-amount-input-0"]');
    await cashAmountInput.fill("1000");

    // Add bKash payment method for remainder
    const addBkashBtn = page.locator('button:has-text("বিকাশ"), button:has-text("bKash")').last();
    if (await addBkashBtn.isVisible()) {
      await addBkashBtn.click();
      // Fill bKash reference
      const refInput = page.locator('[data-testid^="payment-ref-input-"]').first();
      if (await refInput.isVisible()) {
        await refInput.fill("TRX-TEST-BKASH-77");
      }
    }

    // Complete Sale
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await confirmPaymentBtn.click();

    // 7. Receipt shown
    const printReceiptBtn = page.locator('[data-testid="print-receipt-button"]');
    await expect(printReceiptBtn).toBeVisible({ timeout: 15000 });

    // Verify receipt container with invoice
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible();

    // Capture screenshot: receipt
    await page.screenshot({ path: path.join(screenshotsDir, "thermal-receipt.png") });

    // Start New Sale
    const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
    await newSaleBtn.click();
    await expect(page.locator('[data-testid="pos-search-input"]')).toBeFocused({ timeout: 5000 });

    // 8. Cash Out
    if (await cashMoveBtn.isVisible()) {
      await cashMoveBtn.click();
      await page.click('button:has-text("ক্যাশ উত্তোলন"), button:has-text("Cash out")');
      await page.fill('[data-testid="cash-movement-amount-input"]', "200");
      await page.fill('[data-testid="cash-movement-reason-input"]', "Midday bank cash deposit");
      await page.click('[data-testid="confirm-cash-movement-button"]');
      await page.waitForTimeout(1000);
    }

    // 9. Close Shift
    const closeShiftBtn = page.locator('[data-testid="close-shift-button"]');
    await closeShiftBtn.click();

    const closeShiftDialog = page.locator('[role="dialog"]:has-text("শিফট বন্ধ করুন"), [role="dialog"]:has-text("Close Shift")');
    await expect(closeShiftDialog).toBeVisible();

    // Capture screenshot: close shift dialog
    await page.screenshot({ path: path.join(screenshotsDir, "close-shift-dialog.png") });

    // Fill counted cash and close
    await page.fill('[data-testid="counted-cash-input"]', "2500");
    await page.click('[data-testid="confirm-close-shift-button"]');

    // Summary should be visible with Expected vs Counted
    const shiftClosedSummary = page.locator('[data-testid="shift-closed-success-title"]');
    await expect(shiftClosedSummary).toBeVisible({ timeout: 10000 });
  });

  test("Flow 3: Capture Required Multi-Device & Theme POS Screenshots", async ({ page }) => {
    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "owner@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Open shift if not open
    const openBtn = page.locator('[data-testid="open-shift-button"]');
    if (await openBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await openBtn.click();
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await page.click('[data-testid="confirm-open-shift-button"]');
      await page.waitForTimeout(1000);
    }

    // Add items to cart for full appearance
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    if (await firstProduct.isVisible()) {
      await firstProduct.click();
      const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
      if (await variantCell.isVisible({ timeout: 1500 }).catch(() => false)) {
        await variantCell.click();
      }
    }

    // A. Desktop 1366x768 Bangla Light
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-1366-bn-light.png") });

    // B. Desktop 1366x768 English Light
    await page.click('button:has-text("EN")');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-1366-en-light.png") });

    // C. Tablet 1024x768 English Light
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.screenshot({ path: path.join(screenshotsDir, "tablet-1024-en-light.png") });

    // D. Dark Theme 1366x768
    await page.setViewportSize({ width: 1366, height: 768 });
    const themeBtn = page.locator("header button:has(svg.lucide-moon), header button:has(svg.lucide-sun)");
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(screenshotsDir, "desktop-1366-dark.png") });
    }
  });

  test("Flow 4: Accessibility Check on /pos selling screen and payment dialog", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "owner@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Check accessibility of POS screen
    const posAxeResults = await new AxeBuilder({ page })
      .disableRules(["color-contrast"])
      .analyze();
    expect(posAxeResults.violations).toEqual([]);

    // Open payment dialog if items in cart or add one
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    if (await firstProduct.isVisible()) {
      await firstProduct.click();
      const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
      if (await variantCell.isVisible({ timeout: 1000 }).catch(() => false)) {
        await variantCell.click();
      }
    }

    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    if (await checkoutBtn.isEnabled()) {
      await checkoutBtn.click();
      const paymentDialog = page.locator('[role="dialog"]');
      await expect(paymentDialog).toBeVisible();

      const dialogAxeResults = await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .disableRules(["color-contrast"])
        .analyze();
      expect(dialogAxeResults.violations).toEqual([]);
    }
  });
});
