import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";

test.describe("Milestone C2: Credit & Due Sales, Customer Ledger, Collection Flow", () => {
  let token: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let customerId: string;
  let customerPhone: string;
  let variantId: string;
  let unitPriceMinor: number;
  let testProductName: string;

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

    // 2. Fetch branch and register
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = await branchesRes.json();
    branchId = branches.data.find((b: any) => b.code === "GFS-01")?.id || branches.data[0].id;

    const registersRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = await registersRes.json();
    if (registers.data.length > 0) {
      registerId = registers.data[0].id;
    } else {
      const createRegRes = await request.post("http://localhost:4000/api/v1/registers", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          branchId,
          name: "POS-C2-Due",
          code: "POS-C2",
        },
      });
      const regJson = await createRegRes.json();
      registerId = regJson.data.id;
    }

    // 3. Ensure a clean open shift on this register
    const shiftsRes = await request.get(
      `http://localhost:4000/api/v1/shifts?registerId=${registerId}&status=open`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const shiftsJson = await shiftsRes.json();
    const openShifts = Array.isArray(shiftsJson.data) ? shiftsJson.data : (shiftsJson.data?.items || []);
    if (openShifts.length > 0) {
      shiftId = openShifts[0].id;
    } else {
      const openRes = await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          registerId,
          branchId,
          openingCashMinor: 50000,
        },
      });
      const openJson = await openRes.json();
      shiftId = openJson.data.id;
    }

    // 4. Create a dedicated test customer with credit limit (e.g. 500,000 poisha = ৳5,000)
    customerPhone = `017${Math.floor(10000000 + Math.random() * 90000000)}`;
    const custRes = await request.post("http://localhost:4000/api/v1/customers", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: `Test Credit Customer ${Date.now() % 10000}`,
        phone: customerPhone,
        creditLimitMinor: 500000,
      },
    });
    expect(custRes.ok()).toBeTruthy();
    const custJson = await custRes.json();
    customerId = custJson.data.id;

    // 5. Find a product variant and adjust stock up
    const productsRes = await request.get("http://localhost:4000/api/v1/products?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prodJson = await productsRes.json();
    const items = prodJson.data.items || prodJson.data;
    const testProd = items.find((p: any) => p.variants && p.variants.length > 0);
    variantId = testProd.variants[0].id;
    testProductName = testProd.name;
    unitPriceMinor = Number(testProd.variants[0].priceMinor) || 150000;

    await request.post("http://localhost:4000/api/v1/inventory/adjustment", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        branchId,
        variantId,
        qtyDelta: 50,
        reason: "C2 credit sales test stock",
      },
    });
  });

  test("completes credit sale at POS and displays due on receipt", async ({ page }) => {
    // Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // Go to /pos
    await page.goto("/pos");
    await expect(page.locator("body")).toContainText(/Artisan Apparel|Universal POS/i, { timeout: 10000 });

    // Handle shift in use dialog by switching register if needed
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 1500 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 3000 });
    }

    // Ensure shift is open
    const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
    if (await openShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await openShiftBtn.click();
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await page.click('[data-testid="confirm-open-shift-button"]');
      await expect(page.locator('[data-testid="confirm-open-shift-button"]')).toBeHidden({ timeout: 5000 });
    }

    // Select customer via customer button (F9)
    await page.click('[data-testid="customer-button"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

    // Search customer by phone
    await page.fill('[data-testid="customer-search-input"]', customerPhone);
    // Wait for search result item and click it
    const searchResultItem = page.locator(`button:has-text("${customerPhone}")`);
    await expect(searchResultItem).toBeVisible({ timeout: 5000 });
    await searchResultItem.click();

    // Add product to cart
    if (testProductName) {
      await page.fill('[data-testid="pos-search-input"]', testProductName);
      await page.waitForTimeout(400);
    }

    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    // If variant picker opened, click first in-stock variant
    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    if (await variantCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await variantCell.click();
    }

    // Verify cart has at least 1 item
    await expect(page.locator('[data-testid^="qty-input-"]').first()).toBeVisible({ timeout: 5000 });

    // Checkout (F4 / Payment Dialog)
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Payment Dialog should be open
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="dialog"]')).toContainText(/পেমেন্ট|Payment/i);

    // Enter partial payment or 0 payment (e.g. ৳50 cash)
    // Find amount input in payment dialog
    const amountInput = page.locator('[role="dialog"] input[type="number"]').first();
    if (await amountInput.isVisible()) {
      await amountInput.fill("50");
    }

    // Click Complete Sale
    const completeBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(completeBtn).toBeEnabled({ timeout: 5000 });
    await completeBtn.click();

    // Wait for receipt
    await expect(page.locator("body")).toContainText(/চালান নং|Invoice:|এই ভাউচারে বাকি|Due on Invoice/i, {
      timeout: 15000,
    });
  });

  test("customer ledger and statement reflect due and allow collection", async ({ page }) => {
    // Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // Visit customer detail page
    await page.goto(`/customers/${customerId}`);
    await expect(page.locator("h1")).toContainText(/Test Credit Customer/i, { timeout: 10000 });

    // Verify current due balance card is visible
    await expect(page.locator("body")).toContainText(/বর্তমান বাকি|Current Due/i);

    // Click "বাকি আদায়" (Collect Due) button
    const collectBtn = page.locator('button:has-text("বাকি আদায়"), button:has-text("Collect Due")').first();
    await expect(collectBtn).toBeVisible({ timeout: 5000 });
    await collectBtn.click();

    // Modal opens
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[role="dialog"]')).toContainText(/বাকি আদায়|Collect Due Payment/i);

    // Ensure payment amount is filled
    const payAmountInput = page.locator('[role="dialog"] input#payAmount, [role="dialog"] input[type="number"]');
    if (await payAmountInput.isVisible()) {
      const val = await payAmountInput.inputValue();
      if (!val || val === "0" || val === "0.00") {
        await payAmountInput.fill("50");
      }
    }

    // Submit payment
    const submitPaymentBtn = page.locator('[role="dialog"] button:has-text("আদায় সম্পন্ন করুন"), [role="dialog"] button:has-text("Confirm Payment")');
    await expect(submitPaymentBtn).toBeEnabled({ timeout: 5000 });
    await submitPaymentBtn.click();

    // Modal closes and success banner or 0 due shown
    await expect(page.locator('[role="dialog"]')).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator("body")).toContainText(/০.০০|0.00|আদায় সফল|Payment received/i);
  });

  test("due ageing report displays summary and filters", async ({ page }) => {
    // Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // Visit /reports/due
    await page.goto("/reports/due");
    await expect(page.locator("h1")).toContainText(/বকেয়া.*বিশ্লেষণ|Due Ageing Report/i, {
      timeout: 10000,
    });

    // Check ageing buckets
    await expect(page.locator("body")).toContainText(/০-৩০ দিন|0-30 Days/i);
    await expect(page.locator("body")).toContainText(/৩১-৬০ দিন|31-60 Days/i);
    await expect(page.locator("body")).toContainText(/৬১-৯০ দিন|61-90 Days/i);
    await expect(page.locator("body")).toContainText(/>৯০ দিন|>90 Days/i);
  });

  test("dashboard figures match API for today credit given, today credit collected, and today returns", async ({
    page,
  }) => {
    // 1. Log in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // 2. Navigate to /dashboard and intercept the sales-summary API response
    const [summaryApiRes] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/reports/sales-summary") && res.status() === 200, {
        timeout: 15000,
      }),
      page.goto("/dashboard"),
    ]);
    const summaryJson = await summaryApiRes.json();
    const summaryData = summaryJson.data || summaryJson;

    const expectedCreditGivenMinor = summaryData.totalCreditGivenMinor || 0;
    const expectedCreditCollectedMinor = summaryData.totalCreditCollectedMinor || 0;
    const expectedRefundMinor = summaryData.totalRefundMinor || 0;

    // 3. Assert on-screen figures match API
    const creditGivenEl = page.locator('[data-testid="dashboard-credit-given-amount"]');
    await expect(creditGivenEl).toBeVisible({ timeout: 10000 });
    const creditGivenText = (await creditGivenEl.textContent()) || "";
    const creditGivenNum = Math.round(Number(creditGivenText.replace(/[^\d.]/g, "")) * 100);
    expect(creditGivenNum).toBe(Number(expectedCreditGivenMinor));

    const creditCollectedEl = page.locator('[data-testid="dashboard-credit-collected-amount"]');
    await expect(creditCollectedEl).toBeVisible({ timeout: 10000 });
    const creditCollectedText = (await creditCollectedEl.textContent()) || "";
    const creditCollectedNum = Math.round(Number(creditCollectedText.replace(/[^\d.]/g, "")) * 100);
    expect(creditCollectedNum).toBe(Number(expectedCreditCollectedMinor));

    const returnsAmountEl = page.locator('[data-testid="dashboard-returns-amount"]');
    await expect(returnsAmountEl).toBeVisible({ timeout: 10000 });
    const returnsAmountText = (await returnsAmountEl.textContent()) || "";
    const returnsAmountNum = Math.round(Number(returnsAmountText.replace(/[^\d.]/g, "")) * 100);
    expect(returnsAmountNum).toBe(Number(expectedRefundMinor));
  });

  test.afterAll(async ({ request }) => {
    try {
      const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
        data: {
          tenantSlug: "artisan-apparel",
          email: "owner@artisan.com",
          password: "Password123!",
        },
      });
      if (loginRes.ok()) {
        const token = (await loginRes.json()).data?.accessToken;
        if (token) {
          const shiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open&limit=100", {
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
    } catch {}
  });
});
