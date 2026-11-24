import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";

test.describe("Milestone E3: Coupons POS Flow E2E Test", () => {
  let token: string;
  let promoId: string;
  let couponCode = `EID${Math.floor(1000 + Math.random() * 9000)}`;

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

    // 2. Clean up any active promotions and lingering shifts
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
            notes: "E2E Coupons Test Shift",
          },
        }).catch(() => {});
      }
    } catch {}

    // 3. Create active Bill Threshold Promotion with coupon requirement
    const promoRes = await request.post("http://localhost:4000/api/v1/promotions", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: "Eid Special Coupon 500",
        description: "৳500 off on ৳1000 with coupon",
        type: "BILL_THRESHOLD",
        status: "active",
        priority: 60,
        stackableWithBill: true,
        conditions: {
          couponRequired: true,
        },
        config: {
          thresholdMinor: 100000, // ৳1,000 threshold
          discountType: "AMOUNT",
          amountMinor: 50000, // ৳500 discount
        },
        targets: { targetType: "ALL" },
      },
    });
    expect(promoRes.ok()).toBeTruthy();
    const promoData = await promoRes.json();
    promoId = (promoData.data || promoData).id;

    // 4. Create coupon EID500
    const couponRes = await request.post(`http://localhost:4000/api/v1/promotions/${promoId}/coupons`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        code: couponCode,
        usageLimitTotal: 10,
        usageLimitPerCustomer: 5,
      },
    });
    expect(couponRes.ok()).toBeTruthy();
  });

  test.afterAll(async ({ request }) => {
    if (promoId && token) {
      await request.post(`http://localhost:4000/api/v1/promotions/${promoId}/end`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
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

  async function ensureShiftIsOpen(page: any) {
    const confirmBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "500");
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"], button:has-text("শিফট শুরু করুন")');
      if (await openShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
        await openShiftBtn.click();
        await page.waitForTimeout(300);
        if (await confirmBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
          await page.fill('[data-testid="opening-cash-input"]', "500");
          await confirmBtn.click();
          await expect(confirmBtn).toBeHidden({ timeout: 5000 });
        }
      }
    }
  }

  test("type a code, see the saving, finish the sale, and receipt shows the code", async ({ page, request }) => {
    await loginAndGoToPos(page);
    await ensureShiftIsOpen(page);

    // 1. Add product to cart to exceed ৳1,000 threshold
    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    const varCells = page.locator('[data-testid^="variant-cell-"]');
    await expect(varCells.first()).toBeVisible({ timeout: 8000 });
    await varCells.first().click();
    await expect(varCells.first()).toBeHidden({ timeout: 5000 });

    // Ensure cart qty is at least 2 to guarantee > ৳1,000 threshold
    const qtyPlus = page.locator('[data-testid="qty-plus-0"]');
    await expect(qtyPlus).toBeVisible({ timeout: 5000 });
    await qtyPlus.click();
    await page.waitForTimeout(300);

    // 2. Type an invalid coupon first: see error message
    const couponInput = page.locator('[data-testid="coupon-code-input"]');
    await expect(couponInput).toBeVisible({ timeout: 5000 });
    await couponInput.fill("INVALID99");
    await page.waitForTimeout(400);

    const errorMsg = page.locator('[data-testid="coupon-error-msg"]');
    await expect(errorMsg).toBeVisible({ timeout: 5000 });

    // 3. Type valid coupon EID500: see savings badge
    await couponInput.fill(couponCode);
    await page.waitForTimeout(400);

    const savingBadge = page.locator('[data-testid="coupon-saving-badge"]');
    await expect(savingBadge).toBeVisible({ timeout: 5000 });
    await expect(savingBadge).toContainText("500");

    // 4. Checkout
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"], [data-testid="checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // 5. Confirm Payment
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // 6. Verify Receipt displays coupon code
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });

    const receiptCouponCode = page.locator('[data-testid="receipt-coupon-code"]');
    await expect(receiptCouponCode).toBeVisible({ timeout: 5000 });
    await expect(receiptCouponCode).toContainText(couponCode);

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });
  });
});
