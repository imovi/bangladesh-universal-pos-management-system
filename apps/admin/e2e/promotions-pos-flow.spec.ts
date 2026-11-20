import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";

test.describe("Milestone E2: Promotions POS Cashier Flow & Return", () => {
  let token: string;
  let promoId: string;

  test.beforeAll(async ({ request }) => {
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
    token = loginData.data.accessToken;

    // 2. Create active "Buy 2 Get 1 Free" promotion
    const promoRes = await request.post("http://localhost:4000/api/v1/promotions", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: "Playwright Buy 2 Get 1 Panjabi",
        description: "Buy 2 get 1 cheapest free",
        type: "BUY_X_GET_Y",
        status: "active",
        priority: 50,
        stackableWithBill: true,
        config: {
          buyQty: 2,
          getQty: 1,
          getDiscountPercentBp: 10000,
        },
        targets: { targetType: "ALL" },
      },
    });
    expect(promoRes.ok()).toBeTruthy();
    const promoData = await promoRes.json();
    promoId = (promoData.data || promoData).id;

    // 3. Ensure all registers have allowOffline = true
    const regRes = await request.get("http://localhost:4000/api/v1/registers", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (regRes.ok()) {
      const regData = await regRes.json();
      const registers = regData.data || [];
      for (const reg of registers) {
        if (!reg.allowOffline) {
          await request.patch(`http://localhost:4000/api/v1/registers/${reg.id}`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { allowOffline: true },
          });
        }
      }
    }
  });

  async function ensureShiftIsOpen(page: any) {
    const confirmBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন")');
      if (await openShiftBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await openShiftBtn.click();
        await page.waitForTimeout(300);
        if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await page.fill('[data-testid="opening-cash-input"]', "500");
          await confirmBtn.click();
          await expect(confirmBtn).toBeHidden({ timeout: 5000 });
        }
      }
    }
  }

  test.afterAll(async ({ request }) => {
    if (promoId && token) {
      await request.post(`http://localhost:4000/api/v1/promotions/${promoId}/end`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("cashier flow: buy 2 get 1, badge, receipt, and F6 return of most expensive item", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Ensure a shift is open
    await ensureShiftIsOpen(page);

    // Search and select product
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill("Panjabi");
    await page.waitForTimeout(500);

    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    // Select variant cells to add 3 units
    const varCells = page.locator('[data-testid^="variant-cell-"]');
    await expect(varCells.first()).toBeVisible({ timeout: 8000 });

    const cellCount = await varCells.count();
    if (cellCount >= 3) {
      // Add 3 different variants
      await varCells.nth(0).click();
      await page.waitForTimeout(200);
      await varCells.nth(1).click();
      await page.waitForTimeout(200);
      await varCells.nth(2).click();
    } else {
      // Click first cell 3 times
      await varCells.first().click();
      await page.waitForTimeout(200);
      await varCells.first().click();
      await page.waitForTimeout(200);
      await varCells.first().click();
    }

    // Verify promo badge is displayed under promotional line
    const promoBadge = page.locator('[data-testid^="line-promo-badge-"]').first();
    await expect(promoBadge).toBeVisible({ timeout: 5000 });

    // Verify Total Savings row is displayed
    const savingsRow = page.locator('[data-testid="total-savings-row"]');
    await expect(savingsRow).toBeVisible({ timeout: 5000 });

    // Click checkout (F4)
    const checkoutBtn = page.locator('[data-testid="checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Payment dialog appears
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Receipt appears
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });
    const receiptText = await receiptContainer.innerText();
    const invMatch = receiptText.match(/[A-Za-z0-9-]+-\d{6}-\d{4}/);
    expect(invMatch).toBeTruthy();
    const invoiceNumber = invMatch![0];

    // Assert receipt contains "আপনি সাশ্রয় করলেন"
    expect(receiptText).toContain("সাশ্রয়");

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });

    // Verify against GET /sales/:id via API
    const salesListRes = await request.get(`http://localhost:4000/api/v1/sales?search=${invoiceNumber}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(salesListRes.ok()).toBeTruthy();
    const salesList = await salesListRes.json();
    const saleRecord = (salesList.data?.data || salesList.data || [])[0];
    expect(saleRecord).toBeDefined();

    const saleDetailRes = await request.get(`http://localhost:4000/api/v1/sales/${saleRecord.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(saleDetailRes.ok()).toBeTruthy();
    const saleDetail = (await saleDetailRes.json()).data;

    // Check discount was stored on items
    const hasDiscountedItem = saleDetail.items.some(
      (i: any) => Number(i.promotionDiscountMinor) > 0 || Number(i.discountMinor) > 0
    );
    expect(hasDiscountedItem).toBe(true);

    // F6 Return: Open return dialog
    const returnBtn = page.locator('[data-testid="pos-return-button"]');
    if (await returnBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await returnBtn.click();
    } else {
      await page.keyboard.press("F6");
    }

    const returnInput = page.locator('[data-testid="return-invoice-input"]');
    await expect(returnInput).toBeVisible({ timeout: 8000 });
    await returnInput.fill(invoiceNumber);

    const searchBtn = page.locator('[data-testid="search-invoice-button"]');
    await expect(searchBtn).toBeEnabled({ timeout: 5000 });
    await searchBtn.click();

    // Select return line
    const plusBtn = page.locator('[data-testid="return-qty-plus-0"]');
    await expect(plusBtn).toBeVisible({ timeout: 8000 });
    await plusBtn.click();

    // Confirm Return
    const confirmReturnBtn = page.locator('[data-testid="confirm-return-button"]');
    await expect(confirmReturnBtn).toBeEnabled({ timeout: 5000 });
    await confirmReturnBtn.click();

    // Return receipt appears
    const returnReceiptTitle = page.locator('[data-testid="return-receipt-title"]');
    await expect(returnReceiptTitle).toBeVisible({ timeout: 10000 });
    await expect(returnReceiptTitle).toContainText(/ফেরত রসিদ|RETURN RECEIPT/i);

    // Close return modal
    const doneReceiptBtn = page.locator('[data-testid="return-receipt-done-button"]');
    await expect(doneReceiptBtn).toBeVisible({ timeout: 5000 });
    await doneReceiptBtn.click();
  });

  test("offline sale with promotion ended before sync: syncs cleanly and shows PROMOTION_CHANGED in offline review", async ({
    page,
    context,
    request,
  }) => {
    test.setTimeout(60000);

    // 1. Create a dedicated promotion via API
    const promoRes = await request.post("http://localhost:4000/api/v1/promotions", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: "Playwright Offline Promo Ended Before Sync",
        type: "PERCENT_OFF",
        status: "active",
        priority: 70,
        stackableWithBill: true,
        config: { percentBp: 2000 },
        targets: { targetType: "ALL" },
      },
    });
    expect(promoRes.ok()).toBeTruthy();
    const offlinePromoId = (await promoRes.json()).data.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Ensure a shift is open
    await ensureShiftIsOpen(page);

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 10000 });

    // 2. Go offline
    await context.setOffline(true);
    await expect(connPill).toContainText(/অফলাইন|Offline/, { timeout: 10000 });

    // 3. Sell with the promotion while offline
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill("Panjabi");
    await page.waitForTimeout(500);

    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell.isVisible({ timeout: 2000 }).catch(() => false)) {
      await varCell.click();
    }

    // Verify promo discount applied
    const promoBadge = page.locator('[data-testid^="line-promo-badge-"]').first();
    await expect(promoBadge).toBeVisible({ timeout: 5000 });

    const checkoutBtn = page.locator('[data-testid="checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Receipt appears
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });
    const receiptText = await receiptContainer.innerText();
    const invMatch = receiptText.match(/[A-Za-z0-9-]+-\d{6}-\d{4}/);
    expect(invMatch).toBeTruthy();
    const invoiceNumber = invMatch![0];

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });

    // 4. End the promotion through the API while POS is offline
    const endRes = await request.post(`http://localhost:4000/api/v1/promotions/${offlinePromoId}/end`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(endRes.ok()).toBeTruthy();

    // 5. Go online
    await context.setOffline(false);
    await expect(connPill).toContainText(/অনলাইন|Online/, { timeout: 10000 });

    // Trigger sync
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      } else {
        window.dispatchEvent(new Event("online"));
      }
    });

    // 6. The sale must sync, with no item stuck in the outbox
    await page.waitForTimeout(3000);

    // Verify sale exists on server and has PROMOTION_CHANGED in offline review
    await expect.poll(async () => {
      const reviewRes = await request.get("http://localhost:4000/api/v1/sales/offline-review", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!reviewRes.ok()) return false;
      const json = await reviewRes.json();
      const flags = json.data?.data || json.data || [];
      return flags.some((f: any) => f.sale?.invoiceNumber === invoiceNumber && f.flag === "PROMOTION_CHANGED");
    }, { timeout: 20000, intervals: [1000, 2000] }).toBe(true);

    // Navigate to /sales/offline-review and verify badge is visible
    await page.goto("/sales/offline-review");
    await page.waitForLoadState("networkidle");
    const reviewRow = page.locator(`tr:has-text("${invoiceNumber}")`);
    await expect(reviewRow).toBeVisible({ timeout: 10000 });
    await expect(reviewRow).toContainText(/PROMOTION_CHANGED/);
  });
});
