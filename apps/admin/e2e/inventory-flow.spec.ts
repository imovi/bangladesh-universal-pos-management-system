import { test, expect } from "@playwright/test";

test.describe("Milestone A4: Stock & Inventory E2E Flow", () => {
  test("sets opening stock through the grid, adjusts one cell, and sees both in the movement history", async ({
    page,
  }) => {
    // 1. Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate to Inventory and then Opening Stock
    await page.goto("/inventory/opening");
    await page.waitForSelector('[data-testid="opening-branch-select"]', { state: "visible" });

    // Select the first product available
    const productSelect = page.locator('[data-testid="opening-product-select"]');
    // Wait until options are populated
    await expect(productSelect.locator("option")).not.toHaveCount(1, { timeout: 10000 });
    
    // Choose a product option (use the last product to avoid movement log overflow from other test suites)
    const optionValues = await productSelect.locator("option").all();
    const targetOption = optionValues.length > 2 ? optionValues[optionValues.length - 1] : optionValues[1];
    const productValue = await targetOption.getAttribute("value");
    const productName = await targetOption.innerText();
    await productSelect.selectOption(productValue!);

    // Wait for the SizeColorGrid to render
    await page.waitForSelector('[data-testid="size-color-grid"]', { state: "visible", timeout: 10000 });

    // Fill unit cost
    await page.fill('[data-testid="opening-unit-cost-input"]', "750");

    // Use bulk fill to set 20 across all active cells
    await page.fill('[data-testid="grid-bulk-input"]', "20");
    await page.click('[data-testid="grid-bulk-apply-btn"]');

    // Click Save Opening Stock
    await page.click('[data-testid="btn-save-opening-stock"]');

    // Verify success banner appears
    await expect(page.locator('[data-testid="success-alert"]')).toContainText("প্রারম্ভিক মজুদ সফলভাবে সংরক্ষণ করা হয়েছে", {
      timeout: 10000,
    });

    // 3. Navigate to Stock Levels page via sidebar link
    await page.click('a[href="/inventory/stock"]');
    await page.waitForURL("**/inventory/stock", { timeout: 15000 });
    await page.waitForSelector('[data-testid="stock-levels-table"]', { state: "visible" });

    // Search for the product
    await page.fill('[data-testid="stock-search-input"]', productName.trim());
    await page.waitForTimeout(600);

    // Verify stock rows exist
    const stockRow = page.locator('[data-testid="stock-level-row"]').first();
    await expect(stockRow).toBeVisible();

    const qtyBadge = stockRow.locator('[data-testid="stock-qty-badge"]');
    const initialQtyText = await qtyBadge.innerText();
    const initialQty = parseInt(initialQtyText.trim(), 10);
    expect(initialQty).toBeGreaterThan(0);

    // 4. Adjust one cell via Quick Adjust modal
    await stockRow.locator('[data-testid="btn-adjust-row"]').click();
    await page.waitForSelector('[data-testid="adjust-delta-input"]', { state: "visible" });

    // Enter delta -4 and reason
    await page.fill('[data-testid="adjust-delta-input"]', "-4");
    await page.fill('[data-testid="adjust-reason-input"]', "ত্রুটিপূর্ণ বোতাম - নষ্ট হিসেবে বাতিল");
    await page.click('[data-testid="btn-save-adjustment"]');

    // Verify success feedback
    await expect(page.locator('[data-testid="success-alert"]')).toContainText("সমন্বয় করা হয়েছে", {
      timeout: 10000,
    });

    // Verify updated stock level is now (initialQty - 4)
    await expect(qtyBadge).toContainText(String(initialQty - 4));

    // 5. Open Movement History modal
    await stockRow.locator('[data-testid="btn-history-row"]').click();
    await page.waitForSelector('[data-testid="movements-table"]', { state: "visible" });

    // Verify both adjustment (-4) and opening (+20) appear in movement history
    const movementsTable = page.locator('[data-testid="movements-table"]');
    await expect(movementsTable).toContainText(/adjustment/i);
    await expect(movementsTable).toContainText("-4");
    await expect(movementsTable).toContainText(/opening/i);
    await expect(movementsTable).toContainText("+20");
  });
});
