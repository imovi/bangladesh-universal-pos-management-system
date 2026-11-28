import { test, expect, APIRequestContext } from "@playwright/test";
import * as path from "node:path";
import * as fs from "node:fs";
import { closeAllOpenShifts } from "./helpers/shift-cleanup";

const API_BASE_URL = "http://localhost:4000/api/v1";

const CHEMICAL_OWNER = {
  tenantSlug: "chemical-demo",
  email: "owner@chemical.com",
  password: "Password123!",
};

async function loginAsChemicalOwner(request: APIRequestContext): Promise<{ token: string; user: any }> {
  const res = await request.post(`${API_BASE_URL}/auth/login`, { data: CHEMICAL_OWNER });
  if (!res.ok()) {
    throw new Error(`[units-e2e] Login failed: ${await res.text()}`);
  }
  const json = await res.json();
  return { token: json.data.accessToken, user: json.data.user };
}

async function closeChemicalShifts(request: APIRequestContext): Promise<void> {
  try {
    const { token } = await loginAsChemicalOwner(request);
    const res = await request.get(`${API_BASE_URL}/shifts?status=open&limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok()) return;
    const json = await res.json();
    const openShifts = Array.isArray(json.data) ? json.data : (json.data?.items ?? []);
    for (const shift of openShifts) {
      await request.post(`${API_BASE_URL}/shifts/${shift.id}/close`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          closingCashMinor: shift.openingCashMinor || 50000,
          notes: "E2E cleanup",
        },
      });
    }
  } catch {
    // best-effort cleanup
  }
}

test.describe.serial("Phase 2.1: Units and Unit Conversion POS Flow", () => {
  const screenshotsDir = path.resolve(process.cwd(), "../../docs/screenshots/phase2-1");

  test.beforeAll(async ({ request }) => {
    fs.mkdirSync(screenshotsDir, { recursive: true });
    await closeAllOpenShifts(request);
    await closeChemicalShifts(request);
  });

  test.afterAll(async ({ request }) => {
    await closeChemicalShifts(request);
    // Strict requirement: closeAllOpenShifts outside any try/catch
    await closeAllOpenShifts(request);
  });

  test("Comprehensive Units POS lifecycle: multi-unit sale, returns, goods receipts, offline sync", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(180000);

    const { token } = await loginAsChemicalOwner(request);

    // 1. Fetch chemical products and supplier for reference
    const prodRes = await request.get(`${API_BASE_URL}/products?limit=50`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(prodRes.ok()).toBeTruthy();
    const prodBody = await prodRes.json();
    const prods = Array.isArray(prodBody.data) ? prodBody.data : (prodBody.data?.items ?? []);
    const hclProduct = prods.find((p: any) => p.sku === "CHEM-HCL" || p.sku === "CHEM-HCL-01" || p.name.includes("হাইড্রোক্লোরিক"));
    const csProduct = prods.find((p: any) => p.sku === "CHEM-CS" || p.sku === "CHEM-CS-01" || p.name.includes("সোডা"));
    expect(hclProduct).toBeDefined();
    expect(csProduct).toBeDefined();

    // 2. Login to Admin UI as Chemical Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", CHEMICAL_OWNER.tenantSlug);
    await page.fill("#email", CHEMICAL_OWNER.email);
    await page.fill("#password", CHEMICAL_OWNER.password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 3. Capture Screenshot 1: Product form with units
    await page.goto(`/catalog/products/${hclProduct.id}`);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(screenshotsDir, "01-product-form-units.png"), fullPage: true });

    // 4. Navigate to /pos and ensure shift is open
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const startShiftHeaderBtn = page.locator('button:has-text("শিফট শুরু করুন"), button:has-text("Start Shift")');
    if (await startShiftHeaderBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await startShiftHeaderBtn.click();
    }
    const confirmOpenBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmOpenBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmOpenBtn.click();
      await expect(confirmOpenBtn).toBeHidden({ timeout: 10000 });
    }

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 10000 });
    await expect(connPill).toContainText(/অনলাইন|Online/);

    // 5. Build Cart with 3 different units:
    // Line 1: 2.5 kg Caustic Soda by typing quantity
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await searchInput.fill("CHEM-CS-BASE");
    await searchInput.press("Enter");
    await page.waitForTimeout(400);

    const qtyInput0 = page.locator('[data-testid="qty-input-0"]');
    await expect(qtyInput0).toBeVisible({ timeout: 5000 });
    await qtyInput0.click();
    await qtyInput0.fill("2.5");
    await qtyInput0.blur();
    await page.waitForTimeout(300);

    // Line 2: 1 Drum HCl by scanning barcode CHEM-HCL-DRUM200
    await searchInput.fill("CHEM-HCL-DRUM200");
    await searchInput.press("Enter");
    await page.waitForTimeout(400);

    // Line 3: HCl Liter -> switched to Can via unit dropdown
    await searchInput.fill("CHEM-HCL-BASE");
    await searchInput.press("Enter");
    await page.waitForTimeout(400);

    // Find cart unit select on line 2 (3rd line, index 2)
    const unitSelect2 = page.locator('[data-testid="cart-unit-select-2"]');
    await expect(unitSelect2).toBeVisible({ timeout: 5000 });
    // Switch unit to 5L can
    const hclCanUnit = hclProduct.units?.find((u: any) => u.factor === 5 || u.name.includes("ক্যান"));
    if (hclCanUnit) {
      await unitSelect2.selectOption(hclCanUnit.id);
    } else {
      await unitSelect2.selectOption({ label: /5\s*লিটার\s*ক্যান|৫\s*লিটার\s*ক্যান/ });
    }
    await page.waitForTimeout(300);

    // Verify cart grand total: ৳300 + ৳8,500 + ৳225 = ৳9,025
    const grandTotalSpan = page.locator('[data-testid="pos-grand-total"]');
    await expect(grandTotalSpan).toBeVisible();
    await expect(grandTotalSpan).toContainText(/৯,০২৫|9,025/);
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeVisible();
    await expect(checkoutBtn).toBeEnabled();

    // Capture Screenshot 2: POS cart with drum, can, and kg lines
    await page.screenshot({ path: path.join(screenshotsDir, "02-pos-cart-units.png") });

    // 6. Checkout and Pay
    await checkoutBtn.click();
    const paymentDialog = page.locator('[role="dialog"]:has-text("পেমেন্ট সম্পন্ন করুন"), [role="dialog"]:has-text("Complete Payment")');
    await expect(paymentDialog).toBeVisible({ timeout: 5000 });

    const cashAmountInput = page.locator('[data-testid="payment-amount-input-0"]');
    await cashAmountInput.fill("9025");

    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await confirmPaymentBtn.click();

    // 7. Verify Receipt preview showing units
    const printReceiptBtn = page.locator('[data-testid="print-receipt-button"]');
    await expect(printReceiptBtn).toBeVisible({ timeout: 15000 });

    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible();
    const receiptText = await receiptContainer.innerText();
    expect(receiptText).toMatch(/কেজি|kg/);
    expect(receiptText).toContain("ড্রাম");
    expect(receiptText).toContain("ক্যান");

    // Extract invoice number for return
    const invoiceMatch = receiptText.match(/(?:চালান নং:|Invoice:?)\s*([A-Za-z0-9-]+)/i) || receiptText.match(/([A-Z0-9]+-\d{6}-\d{4})/i) || receiptText.match(/INV-[A-Z0-9-]+/);
    const firstSaleInvoice = invoiceMatch ? (invoiceMatch[1] || invoiceMatch[0]).trim() : "";
    expect(firstSaleInvoice).not.toBe("");

    // Capture Screenshot 3: Receipt preview showing units
    await receiptContainer.screenshot({ path: path.join(screenshotsDir, "03-receipt-preview-units.png") });

    // Done with receipt
    const doneReceiptBtn = page.locator('button:has-text("নতুন বিক্রি"), button:has-text("New Sale")');
    if (await doneReceiptBtn.isVisible()) {
      await doneReceiptBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }

    // 8. Check Stock page: HCl stock dropped by 205 liters (1000 - 205 = 795), Caustic Soda dropped by 2.5 kg (500 - 2.5 = 497.5)
    await page.goto("/inventory/stock");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const stockTable = page.locator('[data-testid="stock-levels-table"]');
    await expect(stockTable).toBeVisible({ timeout: 10000 });

    // Capture Screenshot 4: Stock page with Bengali stock breakdown
    await page.screenshot({ path: path.join(screenshotsDir, "04-stock-page-units.png"), fullPage: true });

    const stockPageText = await stockTable.innerText();
    // 795 liters (3 drums 195 liters)
    expect(stockPageText).toMatch(/৭৯৫|795/);
    // 497.5 kg
    expect(stockPageText).toMatch(/৪৯৭\.৫|497\.5/);

    // 9. Return 1 drum from the first sale
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const returnHeaderBtn = page.locator('[data-testid="pos-return-button"]');
    await returnHeaderBtn.click();

    const returnInput = page.locator('[data-testid="return-invoice-input"]');
    await expect(returnInput).toBeVisible({ timeout: 8000 });
    await returnInput.fill(firstSaleInvoice);

    const searchInvoiceBtn = page.locator('[data-testid="search-invoice-button"]');
    await searchInvoiceBtn.click();

    // In return lines, click return-qty-plus on the drum line
    const drumReturnRow = page.locator('[data-testid^="return-line-row-"]:has-text("ড্রাম")').first();
    if (await drumReturnRow.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false)) {
      await drumReturnRow.locator('[data-testid^="return-qty-plus-"]').click();
    } else {
      const drumReturnPlus = page.locator('[data-testid="return-qty-plus-1"]');
      await expect(drumReturnPlus).toBeVisible({ timeout: 8000 });
      await drumReturnPlus.click();
    }

    const confirmReturnBtn = page.locator('[data-testid="confirm-return-button"]');
    await expect(confirmReturnBtn).toBeEnabled();
    await confirmReturnBtn.click();

    const returnReceiptTitle = page.locator('[data-testid="return-receipt-title"]');
    await expect(returnReceiptTitle).toBeVisible({ timeout: 10000 });

    const returnReceiptDone = page.locator('[data-testid="return-receipt-done-button"]');
    await returnReceiptDone.click();

    // Check stock page again: HCl stock increased by 200 liters -> 795 + 200 = 995 liters
    await page.goto("/inventory/stock");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const stockTableAfterReturn = page.locator('[data-testid="stock-levels-table"]');
    await expect(stockTableAfterReturn).toBeVisible({ timeout: 10000 });
    const stockAfterReturnText = await stockTableAfterReturn.innerText();
    expect(stockAfterReturnText).toMatch(/৯৯৫|995/);

    // 10. Goods receipt for 2 drums HCl (+400 liters)
    const branchesRes = await request.get(`${API_BASE_URL}/branches`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branchData = (await branchesRes.json()).data;
    const branch = Array.isArray(branchData) ? branchData[0] : (branchData?.items?.[0] ?? branchData);

    const suppliersRes = await request.get(`${API_BASE_URL}/purchasing/suppliers`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const suppBody = await suppliersRes.json();
    const suppData = suppBody.data;
    let supplier = Array.isArray(suppData) ? suppData[0] : (suppData?.items?.[0] ?? suppData);
    if (!supplier) {
      const createSupp = await request.post(`${API_BASE_URL}/purchasing/suppliers`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { name: "Chemical Supply Co.", contactPerson: "Rafiq", phone: "01711223344" },
      });
      supplier = (await createSupp.json()).data;
    }

    const hclDrumUnit = hclProduct.units.find((u: any) => u.factor === 200 || u.name.includes("ড্রাম"));
    const hclVariant = hclProduct.variants[0];

    const poRes = await request.post(`${API_BASE_URL}/purchasing/orders`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        supplierId: supplier.id,
        branchId: branch.id,
        items: [
          {
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            orderedQty: 2,
            unitCostMinor: 800000,
          },
        ],
      },
    });
    expect(poRes.ok()).toBeTruthy();
    const po = (await poRes.json()).data;

    const grRes = await request.post(`${API_BASE_URL}/purchasing/goods-receipts`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        purchaseOrderId: po.id,
        branchId: branch.id,
        items: [
          {
            purchaseOrderItemId: po.items[0].id,
            variantId: hclVariant.id,
            productUnitId: hclDrumUnit.id,
            receivedQty: 2,
            unitCostMinor: 800000,
          },
        ],
      },
    });
    expect(grRes.ok()).toBeTruthy();

    // Check stock page again: HCl stock increased by 400 liters -> 995 + 400 = 1395 liters
    await page.goto("/inventory/stock");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const stockTableAfterGR = page.locator('[data-testid="stock-levels-table"]');
    await expect(stockTableAfterGR).toBeVisible({ timeout: 10000 });
    const stockAfterGRText = await stockTableAfterGR.innerText();
    expect(stockAfterGRText).toMatch(/১,৩৯৫|1,395|1395/);

    // 11. Go offline, sell 1 can, go online, wait for sync, check server sale & stock
    await page.goto("/pos");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    await expect(connPill).toContainText(/অনলাইন|Online/);
    await context.setOffline(true);
    await expect(connPill).toContainText(/অফলাইন|Offline/, { timeout: 15000 });

    // Sell 1 can HCl using barcode CHEM-HCL-CAN5
    await searchInput.fill("CHEM-HCL-CAN5");
    await searchInput.press("Enter");
    await page.waitForTimeout(400);

    await expect(grandTotalSpan).toContainText(/২২৫|225/);
    await checkoutBtn.click();

    const offlinePaymentDialog = page.locator('[role="dialog"]:has-text("পেমেন্ট সম্পন্ন করুন"), [role="dialog"]:has-text("Complete Payment")');
    await expect(offlinePaymentDialog).toBeVisible({ timeout: 5000 });

    const offlineCashInput = page.locator('[data-testid="payment-amount-input-0"]');
    await offlineCashInput.fill("225");
    const offlineConfirmBtn = page.locator('[data-testid="confirm-payment-button"]');
    await offlineConfirmBtn.click();

    // Receipt with offline badge
    const offlineBadge = page.locator('[data-testid="offline-receipt-badge"]');
    await expect(offlineBadge).toBeVisible({ timeout: 15000 });

    // Go back online and wait for sync
    await context.setOffline(false);
    await expect(connPill).toContainText(/অনলাইন|Online/, { timeout: 15000 });
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      }
    });

    // Give sync worker a moment to process outbox
    await page.waitForTimeout(3000);

    // Verify on server that the synced sale has unitName can and stock is now 1395 - 5 = 1390
    const salesRes = await request.get(`${API_BASE_URL}/sales?limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(salesRes.ok()).toBeTruthy();
    const salesBody = await salesRes.json();
    const recentSales = Array.isArray(salesBody.data) ? salesBody.data : (salesBody.data?.items ?? []);
    const offlineSaleOnServer = recentSales.find((s: any) => s.isOffline === true);
    expect(offlineSaleOnServer).toBeDefined();

    // Check line item has can unit
    const saleDetailRes = await request.get(`${API_BASE_URL}/sales/${offlineSaleOnServer.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(saleDetailRes.ok()).toBeTruthy();
    const saleDetail = (await saleDetailRes.json()).data;
    const canItem = saleDetail.items[0];
    expect(canItem.unitName).toContain("ক্যান");
    expect(Number(canItem.unitFactor)).toBe(5);
    expect(Number(canItem.baseQuantity)).toBe(5);

    // Verify final stock is 1390 liters
    await page.goto("/inventory/stock");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    const finalStockTable = page.locator('[data-testid="stock-levels-table"]');
    await expect(finalStockTable).toBeVisible({ timeout: 10000 });
    const finalStockText = await finalStockTable.innerText();
    expect(finalStockText).toMatch(/১,৩৯০|1,390|1390/);
  });
});
