import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { closeAllOpenShifts } from "./helpers/shift-cleanup";

test.describe("Milestone E4: Loyalty Points POS Flow E2E Test", () => {
  let token: string;
  let customerId: string;
  const customerPhone = "+8801700998811";
  const customerName = "Loyalty Flow Customer";

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

    // 2. Clean up lingering shifts and promotions
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

      await closeAllOpenShifts(request);

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
            notes: "E2E Loyalty Test Shift",
          },
        }).catch(() => {});
      }
    } catch {}

    // 3. Enable loyalty program: earn 1 pt per ৳100 (10000 minor), point value ৳1.00 (100 minor), minRedeem 0
    await request.patch("http://localhost:4000/api/v1/settings/loyalty", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        isEnabled: true,
        earnRateMinor: 10000,
        pointValueMinor: 100,
        minRedeemPoints: 0,
        maxBillSharePercent: 50,
        expiryMonths: 12,
      },
    });

    // 4. Ensure test customer exists and points balance is clean (0)
    const searchRes = await request.get(`http://localhost:4000/api/v1/customers?search=${encodeURIComponent(customerPhone)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const searchData = await searchRes.json();
    const existing = (searchData.data?.items || searchData.data || []).find((c: any) => c.phone === customerPhone);

    if (existing) {
      customerId = existing.id;
      const balance = existing.loyaltyPointsBalance || 0;
      if (balance !== 0) {
        await request.post(`http://localhost:4000/api/v1/customers/${customerId}/loyalty/adjust`, {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            points: -balance,
            reason: "Reset for E2E test",
          },
        }).catch(() => {});
      }
    } else {
      const createRes = await request.post("http://localhost:4000/api/v1/customers", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          name: customerName,
          phone: customerPhone,
        },
      });
      const createData = await createRes.json();
      customerId = (createData.data || createData).id;
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

  async function attachCustomer(page: any) {
    const custBtn = page.locator('[data-testid="customer-button"]');
    await expect(custBtn).toBeVisible({ timeout: 5000 });
    await custBtn.click();

    const searchInput = page.locator('[data-testid="customer-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 5000 });
    await searchInput.fill(customerPhone);
    await page.waitForTimeout(500);

    const custRow = page.locator(`button:has-text("${customerPhone}")`).first();
    await expect(custRow).toBeVisible({ timeout: 5000 });
    await custRow.click();

    // Verify attached on button
    await expect(custBtn).toContainText(customerName);
  }

  async function addProductToCart(page: any) {
    const prodCard = page.locator('[data-testid^="product-card-"]').first();
    await expect(prodCard).toBeVisible({ timeout: 10000 });
    await prodCard.click();

    const varCells = page.locator('[data-testid^="variant-cell-"]');
    await expect(varCells.first()).toBeVisible({ timeout: 8000 });
    await varCells.first().click();
    await expect(varCells.first()).toBeHidden({ timeout: 5000 });
  }

  test("Sale 1 earns points, and Sale 2 redeems points, both verified against API", async ({ page, request }) => {
    await loginAndGoToPos(page);
    await ensureShiftIsOpen(page);

    // ==========================================
    // SALE 1: Earn points with Customer
    // ==========================================
    await attachCustomer(page);
    await addProductToCart(page);

    // Checkout
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"], [data-testid="checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Pay with cash
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Verify Receipt
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });

    const pointsEarnedReceipt = page.locator('[data-testid="receipt-points-earned"]');
    await expect(pointsEarnedReceipt).toBeVisible({ timeout: 5000 });
    const earnedText = await pointsEarnedReceipt.innerText();
    const earnedPts = parseInt(earnedText.replace(/\D/g, ""), 10);
    expect(earnedPts).toBeGreaterThan(0);

    // Check API for updated customer balance
    const custApiRes1 = await request.get(`http://localhost:4000/api/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(custApiRes1.ok()).toBeTruthy();
    const custData1 = await custApiRes1.json();
    const apiBalance1 = (custData1.data || custData1).loyaltyPointsBalance;
    expect(apiBalance1).toBe(earnedPts);

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });

    // ==========================================
    // SALE 2: Redeem part of points
    // ==========================================
    await attachCustomer(page);

    // Verify points badge on customer button displays the earned points
    const loyaltyPill = page.locator('[data-testid="pos-customer-loyalty-pill"]');
    await expect(loyaltyPill).toBeVisible({ timeout: 5000 });
    await expect(loyaltyPill).toContainText(String(earnedPts));

    // Add product to cart again
    await addProductToCart(page);

    // Checkout
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Verify loyalty banner in payment dialog
    const loyaltyBanner = page.locator('[data-testid="payment-loyalty-banner"]');
    await expect(loyaltyBanner).toBeVisible({ timeout: 5000 });
    await expect(loyaltyBanner).toContainText(String(earnedPts));

    // Split payment: Deduct earned points value in taka from cash input
    const cashInput = page.locator('[data-testid="payment-amount-input-0"]');
    await expect(cashInput).toBeVisible({ timeout: 5000 });
    const totalTaka = parseFloat(await cashInput.inputValue());

    // Reduce cash amount by earnedPts (since 1 pt = ৳1.00)
    const cashPortion = Math.max(0, totalTaka - earnedPts);
    await cashInput.fill(String(cashPortion));
    await page.waitForTimeout(300);

    // Add Points payment method for remainder
    const addPointsBtn = page.locator('[data-testid="add-payment-method-points"]');
    await expect(addPointsBtn).toBeVisible({ timeout: 5000 });
    await addPointsBtn.click();
    await page.waitForTimeout(300);

    // Confirm Payment
    await expect(confirmPaymentBtn).toBeEnabled({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Verify Receipt for Sale 2
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });

    const pointsRedeemedReceipt = page.locator('[data-testid="receipt-points-redeemed"]');
    await expect(pointsRedeemedReceipt).toBeVisible({ timeout: 5000 });

    // API check: points should now be decremented
    const custApiRes2 = await request.get(`http://localhost:4000/api/v1/customers/${customerId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(custApiRes2.ok()).toBeTruthy();
    const custData2 = await custApiRes2.json();
    const apiBalance2 = (custData2.data || custData2).loyaltyPointsBalance;
    expect(apiBalance2).toBeLessThan(apiBalance1);

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });
  });

  test.afterAll(async ({ request }) => {
    await closeAllOpenShifts(request);
  });
});
