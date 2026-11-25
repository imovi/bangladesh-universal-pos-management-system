import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "path";
import fs from "fs";

const screenshotsDir = path.resolve(
  process.cwd(),
  process.cwd().endsWith("admin") ? "../../docs/screenshots/pos" : "docs/screenshots/pos",
);

test.describe("Part C: POS Selling Screen & Register Lifecycle Flow", () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  async function cleanupLingeringShifts(request: any) {
    try {
      const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
        data: {
          tenantSlug: "artisan-apparel",
          email: "owner@artisan.com",
          password: "Password123!",
        },
      });
      if (loginRes.ok()) {
        const loginData = await loginRes.json();
        const token = loginData.data?.accessToken;
        if (token) {
          const shiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open", {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (shiftsRes.ok()) {
            const shiftsData = await shiftsRes.json();
            const openShifts = Array.isArray(shiftsData.data) ? shiftsData.data : (shiftsData.data?.items || []);
            for (const s of openShifts) {
              await request.post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
                headers: { Authorization: `Bearer ${token}` },
                data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
              }).catch(() => {});
            }
          }
        }
      }
    } catch {
      // Ignore if offline
    }
  }

  test.beforeAll(async ({ request }) => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    // Clean up any lingering shifts from previous tests to guarantee pristine starting state
    await cleanupLingeringShifts(request);
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

    let cdpClient: any = null;
    if (process.env.CPU_THROTTLE) {
      try {
        cdpClient = await page.context().newCDPSession(page);
        await cdpClient.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.CPU_THROTTLE) });
      } catch {}
    }

    await expect(page.locator('[data-testid="pos-root"]')).toHaveAttribute("data-hydrated", "true", {
      timeout: 40000,
    });

    // Handle shift in use dialog by switching register if needed
    const switchBtn = page.locator('button:has-text("অন্য রেজিস্টার বেছে নিন"), [data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
      await expect(
        page.locator('[data-testid="register-select"], [data-testid="open-shift-button"], [data-testid="confirm-open-shift-button"]')
      ).toBeVisible({ timeout: 5000 });
    }

    // Check discount limit display (5% inside cashier menu pill)
    const cashierBlock = page.locator('[data-testid="cashier-name-block"]');
    await expect(cashierBlock).toBeVisible({ timeout: 20000 });
    await expect(cashierBlock).toBeEnabled({ timeout: 20000 });
    await cashierBlock.click();
    const cashierDropdown = page.locator('[data-testid="cashier-menu-dropdown"]');
    await expect(cashierDropdown).toBeVisible({ timeout: 5000 });
    await expect(page.locator("text=5%")).toBeVisible({ timeout: 5000 });
    await cashierBlock.click();
    await expect(cashierDropdown).toBeHidden({ timeout: 5000 });

    if (cdpClient) {
      try {
        await cdpClient.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      } catch {}
    }

    // Open shift if closed
    const confirmBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmBtn.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
      if (await openShiftBtn.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false)) {
        await openShiftBtn.click();
        await page.fill('[data-testid="opening-cash-input"]', "500");
        await page.click('[data-testid="confirm-open-shift-button"]');
        await expect(page.locator('[data-testid="confirm-open-shift-button"]')).toBeHidden({ timeout: 5000 });
      }
    }

    // Add an item to cart by clicking first product card
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // If variant picker opened, click first in-stock variant
    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await variantCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
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
      const shiftClosedSummary = page.locator('[data-testid="shift-closed-success-title"]');
      await expect(shiftClosedSummary).toBeVisible({ timeout: 10000 });
      const doneBtn = page.locator('[data-testid="done-close-shift-btn"]');
      if (await doneBtn.isVisible()) {
        await doneBtn.click();
        await expect(shiftClosedSummary).toBeHidden({ timeout: 5000 });
      }
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
    await expect(posLink).toBeVisible({ timeout: 10000 });
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
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

    // 3. Wait for Shift status and Open Shift if closed
    const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
    const cashMoveBtn = page.locator('[data-testid="cash-movement-button"]');
    const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    await expect(openShiftBtn.or(cashMoveBtn).or(confirmOpenBtn)).toBeVisible({ timeout: 10000 });

    if (await confirmOpenBtn.isVisible().catch(() => false)) {
      const openCashInput = page.locator('[data-testid="opening-cash-input"]');
      await openCashInput.fill("1000");
      await confirmOpenBtn.click();
      await expect(cashMoveBtn).toBeVisible({ timeout: 10000 });
    } else if (await openShiftBtn.isVisible().catch(() => false)) {
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
      if (await secondVariantCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
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

    // Dismiss any shift in use dialog by switching register if needed
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

    // Open shift if not open
    const openBtn = page.locator('[data-testid="open-shift-button"]');
    if (await openBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
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
      if (await variantCell.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
        await variantCell.click();
      }
    }

    const finalDir = path.resolve(
      process.cwd(),
      process.cwd().endsWith("admin") ? "../../docs/screenshots/final" : "docs/screenshots/final",
    );
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    // A. Desktop 1366x768 Bangla Light (also save final-desktop-pos.png)
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: path.join(screenshotsDir, "desktop-1366-bn-light.png") });
    await page.screenshot({ path: path.join(finalDir, "final-desktop-pos.png") });

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

    // Close shift if open so next tests start cleanly
    const closeShiftBtn = page.locator('[data-testid="close-shift-button"]');
    if (await closeShiftBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await closeShiftBtn.click();
      await page.fill('[data-testid="counted-cash-input"]', "1000");
      await page.click('[data-testid="confirm-close-shift-button"]');
      const doneBtn = page.locator('[data-testid="done-close-shift-btn"]');
      if (await doneBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
        await doneBtn.click();
      }
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

    // Dismiss any shift in use dialog by switching register if needed
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

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
      if (await variantCell.waitFor({ state: "visible", timeout: 1000 }).then(() => true).catch(() => false)) {
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

  test("Flow 5: Strict Data Integrity & Selling Verification (No NaN, Real Stock Match, 6-Variant Grid, Post-Sale API Stock Decrement)", async ({
    page,
  }) => {
    // 1. Sign in as Owner
    await page.goto("/login");
    await page.fill('input[id="tenantSlug"]', "artisan-apparel");
    await page.fill('input[id="email"]', "owner@artisan.com");
    await page.fill('input[id="password"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate to /pos
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Dismiss any shift in use dialog by switching register if needed
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

    // Wait for product cards to load
    const productCards = page.locator('[data-testid^="product-card-"]');
    await expect(productCards.first()).toBeVisible({ timeout: 15000 });

    // Ensure shift is open
    const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
    const cashMoveBtn = page.locator('[data-testid="cash-movement-button"]');
    if (await openShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await openShiftBtn.click();
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await page.click('[data-testid="confirm-open-shift-button"]');
      await expect(cashMoveBtn).toBeVisible({ timeout: 10000 });
    }

    // 3. Assert no element on /pos contains NaN, undefined, null, or Default
    const posBodyText = await page.locator("body").innerText();
    expect(posBodyText).not.toContain("NaN");
    expect(posBodyText).not.toContain("undefined");
    expect(posBodyText).not.toContain("null");
    expect(posBodyText).not.toContain("Default");

    // 4. Assert stock number on Oxford Formal Shirt card
    await page.fill('[data-testid="pos-search-input"]', "Oxford");
    await page.waitForTimeout(500);

    const oxfordCard = page.locator('[data-testid^="product-card-"]:has-text("Oxford Formal Shirt")').first();
    await expect(oxfordCard).toBeVisible({ timeout: 10000 });

    const cardText = await oxfordCard.innerText();
    const stockMatch = cardText.match(/(?:স্টক:|Stock:)\s*(\d+)/);
    expect(stockMatch).not.toBeNull();
    const initialCardStock = parseInt(stockMatch![1], 10);
    expect(Number.isNaN(initialCardStock)).toBe(false);

    // Click Oxford Formal Shirt to open Variant Picker
    await oxfordCard.click();

    // 5. In picker for 6-variant product, assert 6 selectable cells
    const variantModal = page.locator('#variant-picker-title');
    await expect(variantModal).toBeVisible({ timeout: 5000 });

    const selectableCells = page.locator('[data-testid^="variant-cell-"]');
    await expect(selectableCells).toHaveCount(6);

    // Pick specific size and colour: White / L
    const lWhiteCell = page.locator('[data-testid="variant-cell-White-L"]');
    await expect(lWhiteCell).toBeVisible();
    await lWhiteCell.click();

    // 6. Assert cart line shows exact SKU M-OXF-L-WHITE
    const cartLineSku = page.locator('text="M-OXF-L-WHITE"');
    await expect(cartLineSku).toBeVisible({ timeout: 5000 });

    // Increase quantity to 2
    const qtyPlusBtn = page.locator('[data-testid^="qty-plus-"]').first();
    await qtyPlusBtn.click();
    await page.waitForTimeout(300);

    // Assert quantity in cart is 2
    const qtyInput = page.locator('[data-testid^="qty-input-"]').first();
    await expect(qtyInput).toHaveValue("2");

    // 7. Complete sale
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled();
    await checkoutBtn.click();

    // Payment dialog appears
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Receipt view appears
    const newSaleBtn = page.locator('[data-testid="new-sale-button"]');
    await expect(newSaleBtn).toBeVisible({ timeout: 15000 });
    await newSaleBtn.click();

    // Wait for catalog to return to view
    await page.waitForTimeout(500);
    await page.fill('[data-testid="pos-search-input"]', "Oxford");
    await page.waitForTimeout(500);

    // 8. Assert card's stock went down by exactly 2 in UI
    const updatedCardText = await oxfordCard.innerText();
    const updatedStockMatch = updatedCardText.match(/(?:স্টক:|Stock:)\s*(\d+)/);
    expect(updatedStockMatch).not.toBeNull();
    const updatedCardStock = parseInt(updatedStockMatch![1], 10);
    expect(updatedCardStock).toBe(initialCardStock - 2);

    // 9. After page reload, assert it STILL shows the reduced number (from API, not memory)
    await page.reload();
    await page.waitForLoadState("networkidle");
    await page.fill('[data-testid="pos-search-input"]', "Oxford");
    await page.waitForTimeout(500);

    const reloadedCard = page.locator('[data-testid^="product-card-"]:has-text("Oxford Formal Shirt")').first();
    await expect(reloadedCard).toBeVisible({ timeout: 10000 });
    const reloadedCardText = await reloadedCard.innerText();
    const reloadedStockMatch = reloadedCardText.match(/(?:স্টক:|Stock:)\s*(\d+)/);
    expect(reloadedStockMatch).not.toBeNull();
    const reloadedCardStock = parseInt(reloadedStockMatch![1], 10);
    expect(reloadedCardStock).toBe(initialCardStock - 2);

    // Close shift to leave register clean
    const closeShiftBtn = page.locator('[data-testid="close-shift-button"]');
    if (await closeShiftBtn.isVisible()) {
      await closeShiftBtn.click();
      await page.fill('[data-testid="counted-cash-input"]', "2500");
      await page.click('[data-testid="confirm-close-shift-button"]');
      await expect(page.locator('[data-testid="shift-closed-success-title"]')).toBeVisible({ timeout: 10000 });
    }
  });
});
