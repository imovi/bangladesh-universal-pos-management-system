import { test, expect } from "@playwright/test";

test.describe("Milestone A5: Purchasing Flow E2E", () => {
  test("creates supplier, creates purchase order, marks ordered, receives partial goods, and records payment", async ({
    page,
  }) => {
    const timestamp = Date.now();
    const supplierName = `Dhaka Fabrics ${timestamp}`;

    // 1. Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate to Suppliers page
    await page.goto("/purchasing/suppliers");
    await page.waitForSelector('[data-testid="suppliers-table"]', { state: "visible" });

    // Open Create Supplier Modal
    await page.click('[data-testid="btn-add-supplier"]');
    await page.waitForSelector('[data-testid="supplier-name-input"]', { state: "visible" });

    // Fill Supplier Form
    await page.fill('[data-testid="supplier-name-input"]', supplierName);
    await page.fill('[data-testid="supplier-contact-input"]', "Rahim");
    await page.fill('[data-testid="supplier-phone-input"]', "01711998877");
    await page.fill('[data-testid="supplier-email-input"]', `dhaka_${timestamp}@fabrics.test`);
    await page.fill('[data-testid="supplier-address-input"]', "Tejgaon I/A, Dhaka");
    await page.click('[data-testid="supplier-submit-btn"]');

    // Wait for success alert
    await expect(page.locator('[data-testid="success-alert"]')).toBeVisible({ timeout: 10000 });

    // Search for newly created supplier
    await page.fill('[data-testid="supplier-search-input"]', supplierName);
    await page.waitForTimeout(600);
    const supplierRow = page.locator('[data-testid="supplier-row"]').first();
    await expect(supplierRow).toContainText(supplierName);
    await expect(supplierRow.locator('[data-testid="supplier-balance"]')).toContainText("৳ 0.00");

    // 3. Create a Purchase Order
    await page.goto("/purchasing/orders/new");
    await page.waitForSelector('[data-testid="po-supplier-select"]', { state: "visible" });

    // Select the newly created supplier
    const supplierSelect = page.locator('[data-testid="po-supplier-select"]');
    await expect(supplierSelect.locator("option")).not.toHaveCount(1, { timeout: 10000 });
    await supplierSelect.selectOption({ label: supplierName });

    // Select branch if not already selected
    const branchSelect = page.locator('[data-testid="po-branch-select"]');
    const branchOptions = await branchSelect.locator("option").all();
    if (branchOptions.length > 1) {
      const branchVal = await branchOptions[1].getAttribute("value");
      if (branchVal) await branchSelect.selectOption(branchVal);
    }

    // Add Line Item
    const variantSelect = page.locator('[data-testid="po-item-variant-select"]');
    await expect(variantSelect.locator("option")).not.toHaveCount(0, { timeout: 10000 });
    // Wait for initial fetch to settle before overriding quantity and cost
    await page.waitForTimeout(500);

    await page.fill('[data-testid="po-item-qty-input"]', "20");
    await page.fill('[data-testid="po-item-cost-input"]', "450");
    await page.click('[data-testid="btn-add-po-line"]');

    // Verify Line Item added in table
    await expect(page.locator('[data-testid="po-line-row"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="po-grand-total"]')).toContainText("৳ 9,000.00");

    // Save PO
    await page.click('[data-testid="btn-save-po"]');
    await page.waitForURL("**/purchasing/orders/**", { timeout: 15000 });

    // Verify PO Detail Page
    await page.waitForSelector('[data-testid="po-detail-number"]', { state: "visible" });
    await expect(page.locator('[data-testid="po-detail-status"]')).toContainText("খসড়া");

    // Transition status to Ordered
    await page.click('[data-testid="btn-mark-ordered"]');
    await expect(page.locator('[data-testid="po-detail-status"]')).toContainText("অর্ডারকৃত", {
      timeout: 10000,
    });

    // 4. Receive Goods against this PO
    await page.click('[data-testid="btn-receive-po"]');
    await page.waitForURL("**/purchasing/receipts/new?poId=**", { timeout: 15000 });

    // Verify line item is prefilled from PO
    await page.waitForSelector('[data-testid="grn-line-row"]', { state: "visible" });
    await expect(page.locator('[data-testid="grn-line-row"]')).toHaveCount(1);

    // Update received qty to 10 (partial receipt)
    const qtyInput = page.locator('[data-testid="grn-qty-input-0"]');
    await qtyInput.fill("10");
    await expect(page.locator('[data-testid="grn-grand-total"]')).toContainText("৳ 4,500.00");

    // Submit GRN
    await page.click('[data-testid="btn-save-grn"]');
    await page.waitForURL("**/purchasing/receipts/**", { timeout: 15000 });
    await page.waitForSelector('[data-testid="grn-detail-number"]', { state: "visible" });

    // 5. Check Purchase Order Status changed to partially_received
    await page.goto("/purchasing/orders");
    await page.waitForSelector('[data-testid="po-table"]', { state: "visible" });
    const poRow = page.locator('[data-testid="po-row"]').first();
    await expect(poRow).toContainText("আংশিক গৃহীত", { timeout: 10000 });

    // 6. Return to Suppliers, verify balance is updated, and record payment
    await page.goto("/purchasing/suppliers");
    await page.waitForSelector('[data-testid="suppliers-table"]', { state: "visible" });
    await page.fill('[data-testid="supplier-search-input"]', supplierName);
    await page.waitForTimeout(600);

    const updatedSupplierRow = page.locator('[data-testid="supplier-row"]').first();
    await expect(updatedSupplierRow).toContainText(supplierName);
    // Received 10 * 450 = ৳ 4,500.00 payable to supplier
    await expect(updatedSupplierRow.locator('[data-testid="supplier-balance"]')).toContainText("৳ 4,500.00", { timeout: 10000 });

    // Open Payment Modal
    await updatedSupplierRow.locator('[data-testid="btn-pay-supplier"]').click();
    await page.waitForSelector('[data-testid="payment-amount-input"]', { state: "visible" });

    // Fill Payment: 2500 Tk via Cash
    await page.fill('[data-testid="payment-amount-input"]', "2500");
    await page.selectOption('[data-testid="payment-method-select"]', "cash");
    await page.fill('[data-testid="payment-ref-input"]', "PAY-001");
    await page.click('[data-testid="payment-submit-btn"]');

    // Verify Success and Updated Balance: 4,500 - 2,500 = ৳ 2,000.00
    await expect(page.locator('[data-testid="success-alert"]')).toBeVisible({ timeout: 10000 });
    await page.fill('[data-testid="supplier-search-input"]', supplierName);
    await page.waitForTimeout(600);
    const finalSupplierRow = page.locator('[data-testid="supplier-row"]').first();
    await expect(finalSupplierRow.locator('[data-testid="supplier-balance"]')).toContainText("৳ 2,000.00", { timeout: 10000 });

    // 7. Verify Statement Modal
    await finalSupplierRow.locator('[data-testid="btn-statement"]').click();
    await page.waitForSelector('[data-testid="statement-table"]', { state: "visible" });
    await expect(page.locator('[data-testid="statement-table"] tbody tr')).toHaveCount(2, { timeout: 10000 }); // GRN + Payment
    await expect(page.locator('[data-testid="statement-table"]')).toContainText("পণ্য চালান");
    await expect(page.locator('[data-testid="statement-table"]')).toContainText("পেমেন্ট পরিশোধ");
  });
});
