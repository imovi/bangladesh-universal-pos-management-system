import { test, expect } from "@playwright/test";

test.describe("Milestone A3: Products & Variants E2E Flow", () => {
  test("creates a shirt with 4 sizes × 3 colours, edits one variant price, adds barcode, and finds it by barcode", async ({
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

    // 2. Go to New Product Page
    await page.goto("/catalog/products/new");
    await expect(page.locator("h1")).toContainText("নতুন পণ্য যোগ করুন");

    const uniqueSuffix = Date.now().toString().slice(-4);
    const productName = `Custom Polo Shirt ${uniqueSuffix}`;
    const baseSku = `POLO-${uniqueSuffix}`;

    await page.fill("#name", productName);
    await page.fill("#sku", baseSku);
    await page.fill("#price", "1650");
    await page.fill("#cost", "950");

    // Submit form (default options: 4 sizes S,M,L,XL × 3 colours Black,Navy,White)
    await page.click('button[type="submit"]');

    // 3. Verify redirection to Product Detail page
    await page.waitForURL("**/catalog/products/*", { timeout: 15000 });
    await expect(page.locator("h1")).toContainText(productName);

    // Verify 12 variants are generated (4 sizes × 3 colours)
    const variantRows = page.locator('[data-testid="variant-row"]');
    await expect(variantRows).toHaveCount(12);

    // 4. Edit one variant's price
    await variantRows.first().locator('button:has-text("মূল্য পরিবর্তন")').click();
    await page.waitForSelector("#editPriceInput", { state: "visible" });

    await page.fill("#editPriceInput", "1850");
    await page.click('button:has-text("সংরক্ষণ করুন")');

    // Verify price updated
    await expect(variantRows.first()).toContainText("৳ 1,850.00");

    // 5. Add barcode to the variant
    const testBarcode = `890123456${uniqueSuffix}`;
    await variantRows.first().locator('button[title="Add Barcode"]').click();
    await page.waitForSelector("#barcodeInput", { state: "visible" });

    await page.fill("#barcodeInput", testBarcode);
    await page.click('button:has-text("যোগ করুন (Add)")');

    // Verify barcode badge appears
    await expect(variantRows.first()).toContainText(testBarcode);

    // 6. Navigate to Products List and find the variant by that barcode
    await page.goto("/catalog/products");
    await page.waitForSelector('input[placeholder*="খুঁজুন"]', { state: "visible" });

    await page.fill('input[placeholder*="খুঁজুন"]', testBarcode);
    await page.waitForTimeout(500);

    // Verify product appears in search results
    await expect(page.locator("tbody")).toContainText(productName);
  });
});
