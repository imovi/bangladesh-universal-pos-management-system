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

    // 2. Clean up any active promotions and lingering shifts from demo seed
    try {
      const existingPromosRes = await request.get("http://localhost:4000/api/v1/promotions?status=active", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (existingPromosRes.ok()) {
        const existingData = await existingPromosRes.json();
        const activeList = existingData.data?.items || existingData.data?.data || existingData.data || [];
        for (const p of activeList) {
          await request.post(`http://localhost:4000/api/v1/promotions/${p.id}/end`, {
            headers: { Authorization: `Bearer ${token}` },
          }).catch(() => {});
        }
      }

      const shiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (shiftsRes.ok()) {
        const shiftsData = await shiftsRes.json();
        const openShifts = shiftsData.data?.items || shiftsData.data || [];
        for (const s of openShifts) {
          await request.post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
          }).catch(() => {});
        }
      }
      const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const branch = (await branchesRes.json()).data?.[0];
      const regRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branch.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const registers = (await regRes.json()).data || [];
      const reg = registers[0];
      for (const r of registers) {
        if (!r.allowOffline) {
          await request.patch(`http://localhost:4000/api/v1/registers/${r.id}`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { allowOffline: true },
          }).catch(() => {});
        }
      }
      if (reg && branch) {
        await request.post("http://localhost:4000/api/v1/shifts/open", {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            branchId: branch.id,
            registerId: reg.id,
            openingCashMinor: 50000,
            notes: "E2E Promotions Test Shift",
          },
        }).catch(() => {});
      }
    } catch {}

    // 3. Create active "Buy 2 Get 1 Free" promotion
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
  });

  async function ensureShiftIsOpen(page: any) {
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
    }
    const confirmBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন")');
      if (await openShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
        await openShiftBtn.click();
        if (await confirmBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
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

  async function loginAndGoToPos(page: any) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");
  }

  test("cashier flow: buy 2 get 1, badge, receipt, and F6 return of most expensive item", async ({ page, request }) => {
    await loginAndGoToPos(page);

    // Ensure a shift is open
    await ensureShiftIsOpen(page);

    // Select product from POS catalog
    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    // Select variant cell to add 1st unit (modal closes on select)
    const varCells = page.locator('[data-testid^="variant-cell-"]');
    await expect(varCells.first()).toBeVisible({ timeout: 8000 });
    await varCells.first().click();
    await expect(varCells.first()).toBeHidden({ timeout: 5000 });

    // Use cart qty-plus button twice to reach 3 units for Buy 2 Get 1
    const qtyPlus = page.locator('[data-testid="qty-plus-0"]');
    await expect(qtyPlus).toBeVisible({ timeout: 5000 });
    await qtyPlus.click();
    await page.waitForTimeout(300);
    await qtyPlus.click();
    await page.waitForTimeout(300);

    // Verify promo badge is displayed under promotional line
    const promoBadge = page.locator('[data-testid^="line-promo-badge-"]').first();
    await expect(promoBadge).toBeVisible({ timeout: 5000 });

    // Verify Total Savings row is displayed
    const savingsRow = page.locator('[data-testid="total-savings-row"]');
    await expect(savingsRow).toBeVisible({ timeout: 5000 });

    // Click checkout (F4)
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"], [data-testid="checkout-button"]');
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

    // Verify against GET /sales?search=invoiceNumber via API
    const salesListRes = await request.get(`http://localhost:4000/api/v1/sales?search=${encodeURIComponent(invoiceNumber)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(salesListRes.ok()).toBeTruthy();
    const salesList = await salesListRes.json();
    const saleRecord = (salesList.data?.items || salesList.data?.data || salesList.data || [])[0];
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
    if (await returnBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
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
    test.setTimeout(90000);
    page.on("console", (msg) => {
      console.log("POS LOG:", msg.type(), msg.text());
    });

    // 0. Ensure no conflicting active promotions remain
    const existingPromosRes = await request.get("http://localhost:4000/api/v1/promotions?status=active", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (existingPromosRes.ok()) {
      const existingData = await existingPromosRes.json();
      const activeList = existingData.data?.items || existingData.data?.data || existingData.data || [];
      for (const p of activeList) {
        await request.post(`http://localhost:4000/api/v1/promotions/${p.id}/end`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }

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

    await loginAndGoToPos(page);

    // Ensure a shift is open
    await ensureShiftIsOpen(page);

    const connPill = page.locator('[data-testid="connection-status-pill"]');
    await expect(connPill).toBeVisible({ timeout: 10000 });

    // 2. Go offline
    await context.setOffline(true);
    await expect(connPill).toContainText(/অফলাইন|Offline/, { timeout: 10000 });

    // 3. Sell with the promotion while offline
    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await varCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await varCell.click();
    }

    // Verify promo discount applied
    const promoBadge = page.locator('[data-testid^="line-promo-badge-"]').first();
    await expect(promoBadge).toBeVisible({ timeout: 5000 });

    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"], [data-testid="checkout-button"]');
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

    // 5. Go online and trigger sync
    await context.setOffline(false);
    await page.evaluate(() => {
      if (typeof (window as any).__triggerPosSync === "function") {
        (window as any).__triggerPosSync();
      } else {
        window.dispatchEvent(new Event("online"));
      }
    });

    // Wait for the sale to sync and verify PROMOTION_CHANGED flag via API polling
    await expect.poll(async () => {
      const reviewRes = await request.get("http://localhost:4000/api/v1/sales/offline-review", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!reviewRes.ok()) return false;
      const json = await reviewRes.json();
      const flags = json.data?.items || json.data?.data || json.data || [];
      return flags.some((f: any) => f.flag === "PROMOTION_CHANGED");
    }, { timeout: 20000, intervals: [1000, 2000] }).toBe(true);

    // 6. Navigate to /sales/offline-review and verify PROMOTION_CHANGED is flagged
    await page.goto("/sales/offline-review");
    await page.waitForLoadState("domcontentloaded");
    const reviewTable = page.locator("table");
    await expect(reviewTable).toBeVisible({ timeout: 15000 });
    await expect(page.locator("body")).toContainText(/PROMOTION_CHANGED/);
  });
});
