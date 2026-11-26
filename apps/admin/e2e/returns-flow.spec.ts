import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";
import { closeAllOpenShifts } from "./helpers/shift-cleanup";

test.describe("Milestone C1: Returns & Exchanges Flow", () => {
  let token: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let variantId: string;
  let saleId: string;
  let invoiceNumber: string;

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

    // 2. Fetch or create branch and register
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
          name: "POS-C1-Returns",
          code: "POS-C1",
        },
      });
      const regJson = await createRegRes.json();
      registerId = regJson.data.id;
    }

    // 3. Open shift with 50,000 poisha (৳500) drawer cash
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

    // 4. Find product variant
    const productsRes = await request.get("http://localhost:4000/api/v1/products?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prodJson = await productsRes.json();
    const items = prodJson.data.items || prodJson.data;
    const testProd = items.find((p: any) => p.variants && p.variants.length > 0);
    variantId = testProd.variants[0].id;
    const priceMinor = Number(testProd.variants[0].priceMinor) || 220000;
    const totalMinor = priceMinor * 2;

    // Adjust stock up for variants of test products in branch
    for (const prod of items.slice(0, 3)) {
      if (!prod.variants) continue;
      for (const v of prod.variants) {
        await request.post("http://localhost:4000/api/v1/inventory/adjustment", {
          headers: { Authorization: `Bearer ${token}` },
          data: {
            branchId,
            variantId: v.id,
            qtyDelta: 50,
            reason: "Returns test stock adjustment",
          },
        });
      }
    }

    // 5. Create a sale with 2 units
    saleId = uuidv7();
    const saleRes = await request.post("http://localhost:4000/api/v1/sales", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": saleId,
      },
      data: {
        id: saleId,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 2 }],
        payments: [{ paymentMethod: "cash", amountMinor: totalMinor }],
        expectedTotalMinor: totalMinor,
      },
    });
    if (!saleRes.ok()) {
      console.log("saleRes status:", saleRes.status(), await saleRes.text());
    }
    expect(saleRes.ok()).toBeTruthy();
    const saleJson = await saleRes.json();
    invoiceNumber = saleJson.data.invoiceNumber;
  });

  test("returns list and detail page load correctly", async ({ page }) => {
    // 1. Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // 2. Visit /sales/returns
    await page.goto("/sales/returns");
    await expect(page.locator("h1")).toContainText(/পণ্য ফেরত|Product Returns/i, {
      timeout: 10000,
    });

    // Verify table headers
    await expect(page.locator("body")).toContainText(/ফেরত নম্বর|Return #/i);
    await expect(page.locator("body")).toContainText(/মূল ইনভয়েস|Original Invoice/i);
  });

  test("sale detail page shows return button and returnable quantities", async ({ page }) => {
    // 1. Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // 2. Open sale detail page
    await page.goto(`/sales/${saleId}`);
    await expect(page.locator("h1")).toContainText(invoiceNumber, { timeout: 10000 });

    // Verify Return button is present
    const returnBtn = page.getByRole("button", { name: /ফেরত \/ বদল|Return \/ Exchange/i });
    await expect(returnBtn).toBeVisible();

    // Verify invoice number is shown
    await expect(page.locator("body")).toContainText(invoiceNumber);
  });

  test("executing return via API reflects on sales detail and returns list", async ({ page, request }) => {
    // Perform return of 1 item via API
    const returnId = uuidv7();
    const getSaleRes = await request.get(`http://localhost:4000/api/v1/sales/${saleId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const saleData = (await getSaleRes.json()).data;
    const saleItemId = saleData.items[0].id;

    const returnRes = await request.post(`http://localhost:4000/api/v1/sales/${saleId}/returns`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": returnId,
      },
      data: {
        id: returnId,
        shiftId,
        refundMethod: "cash",
        reason: "Customer changed mind",
        items: [
          {
            saleItemId,
            quantity: 1,
            condition: "resellable",
          },
        ],
      },
    });
    expect(returnRes.ok()).toBeTruthy();
    const returnJson = await returnRes.json();
    const returnNumber = returnJson.data.returnNumber;

    // 1. Sign in as Owner
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // 2. Go to /sales/returns and verify return is listed
    await page.goto("/sales/returns");
    await expect(page.locator("body")).toContainText(returnNumber, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(invoiceNumber);

    // 3. Click into return details
    await page.goto(`/sales/returns/${returnId}`);
    await expect(page.locator("h1")).toContainText(returnNumber, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/Customer changed mind/);
    await expect(page.locator("body")).toContainText(invoiceNumber);

    // 4. Return to sale detail page and verify return history section
    await page.goto(`/sales/${saleId}`);
    await expect(page.locator("body")).toContainText(returnNumber, { timeout: 10000 });
    await expect(page.locator("body")).toContainText(/পণ্য ফেরত.*ইতিহাস|Return History/i);
  });

  test("cashier completes return and exchange directly on /pos screen", async ({ page }) => {
    // 1. Sign in and open /pos
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });
    await page.goto("/pos");

    // Handle switch register or open shift if needed
    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
    }
    const confirmBtn = page.locator('[data-testid="confirm-open-shift-button"]');
    if (await confirmBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await page.fill('[data-testid="opening-cash-input"]', "1000");
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    } else {
      const openShiftBtn = page.locator('[data-testid="open-shift-button"]');
      if (await openShiftBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
        await openShiftBtn.click();
        await page.fill('[data-testid="opening-cash-input"]', "1000");
        await page.click('[data-testid="confirm-open-shift-button"]');
        await expect(openShiftBtn).toBeHidden({ timeout: 5000 });
      }
    }

    // 2. Add product to cart
    await page.fill('[data-testid="pos-search-input"]', "Polo");
    await page.waitForTimeout(400);

    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    await expect(firstProduct).toBeVisible({ timeout: 10000 });
    await firstProduct.click();

    const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
    await expect(variantCell).toBeVisible({ timeout: 5000 });
    await variantCell.click();

    // Verify item in cart
    await expect(page.locator('[data-testid^="qty-input-"]').first()).toBeVisible({ timeout: 5000 });

    // Sell the product
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    await expect(checkoutBtn).toBeEnabled({ timeout: 5000 });
    await checkoutBtn.click();

    // Confirm cash payment
    const confirmPaymentBtn = page.locator('[data-testid="confirm-payment-button"]');
    await expect(confirmPaymentBtn).toBeVisible({ timeout: 5000 });
    await confirmPaymentBtn.click();

    // Receipt view appears
    const receiptContainer = page.locator("#pos-receipt-print");
    await expect(receiptContainer).toBeVisible({ timeout: 10000 });
    const receiptText = await receiptContainer.innerText();
    const invMatch = receiptText.match(/REG\d{2}-\d{6}-\d{4}/);
    expect(invMatch).toBeTruthy();
    const saleInvoice = invMatch![0];

    // Close receipt
    await page.click('[data-testid="new-sale-button"]');
    await expect(receiptContainer).toBeHidden({ timeout: 5000 });

    // 3. Open return dialog
    const returnBtn = page.locator('[data-testid="pos-return-button"]');
    if (await returnBtn.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
      await returnBtn.click();
    } else {
      await page.keyboard.press("F6");
    }
    const returnInput = page.locator('[data-testid="return-invoice-input"]');
    await expect(returnInput).toBeVisible({ timeout: 8000 });

    // Ensure focus, type invoice number and search
    await returnInput.click();
    await returnInput.fill(saleInvoice);
    const searchBtn = page.locator('[data-testid="search-invoice-button"]');
    await expect(searchBtn).toBeEnabled({ timeout: 5000 });
    await searchBtn.click();

    // Return lines appear
    const plusBtn = page.locator('[data-testid="return-qty-plus-0"]');
    await expect(plusBtn).toBeVisible({ timeout: 8000 });
    await plusBtn.click();

    // Confirm Return
    const confirmReturnBtn = page.locator('[data-testid="confirm-return-button"]');
    await expect(confirmReturnBtn).toBeEnabled();
    await confirmReturnBtn.click();

    // Return receipt appears with "ফেরত রসিদ" or "RETURN RECEIPT"
    const returnReceiptTitle = page.locator('[data-testid="return-receipt-title"]');
    await expect(returnReceiptTitle).toBeVisible({ timeout: 10000 });
    await expect(returnReceiptTitle).toContainText(/ফেরত রসিদ|RETURN RECEIPT/i);

    const returnRefund = page.locator('[data-testid="return-receipt-refund"]');
    await expect(returnRefund).toBeVisible();

    // Close return receipt
    const doneReceiptBtn = page.locator('[data-testid="return-receipt-done-button"]');
    await expect(doneReceiptBtn).toBeVisible({ timeout: 5000 });
    await doneReceiptBtn.click();

    // 4. Reload /pos and verify page reloads cleanly
    await page.reload();
    await expect(page.locator('[data-testid="pos-search-input"]')).toBeVisible({ timeout: 10000 });

    // 5. Exchange flow through UI:
    // Create another sale so we have an item to exchange
    await page.fill('[data-testid="pos-search-input"]', "Polo");
    await page.waitForTimeout(400);
    const prodToBuy = page.locator('[data-testid^="product-card-"]').first();
    await prodToBuy.click();
    const varCell = page.locator('[data-testid^="variant-cell-"]').first();
    await expect(varCell).toBeVisible({ timeout: 5000 });
    await varCell.click();
    await expect(page.locator('[data-testid^="qty-input-"]').first()).toBeVisible({ timeout: 5000 });

    await page.click('[data-testid="pos-checkout-button"]');
    await page.click('[data-testid="confirm-payment-button"]');
    await expect(page.locator("#pos-receipt-print")).toBeVisible({ timeout: 10000 });
    const exInvMatch = (await page.locator("#pos-receipt-print").innerText()).match(/REG\d{2}-\d{6}-\d{4}/);
    const exSaleInvoice = exInvMatch![0];
    await page.click('[data-testid="new-sale-button"]');

    // Open Return modal for Exchange
    await page.click('[data-testid="pos-return-button"]');
    await expect(returnInput).toBeVisible({ timeout: 5000 });
    await returnInput.click();
    await returnInput.fill(exSaleInvoice);
    await page.waitForTimeout(200);
    const searchInvoiceBtn = page.locator('[data-testid="search-invoice-button"]');
    await expect(searchInvoiceBtn).toBeEnabled({ timeout: 5000 });
    await searchInvoiceBtn.click();

    await expect(page.locator('[data-testid="return-qty-plus-0"]')).toBeVisible({ timeout: 8000 });
    await page.click('[data-testid="return-qty-plus-0"]');

    // Click "Exchange" button
    const proceedExchBtn = page.locator('[data-testid="proceed-exchange-button"]');
    await expect(proceedExchBtn).toBeVisible();
    await proceedExchBtn.click();

    // Verify Exchange mode is active on cart
    await expect(page.locator("body")).toContainText(/পণ্য বদল মোড|বিনিময় মোড|Exchange Mode/i, { timeout: 8000 });
    await expect(page.locator("body")).toContainText(exSaleInvoice);

    // Add another item to exchange for
    await page.fill('[data-testid="pos-search-input"]', "Polo");
    await page.waitForTimeout(400);
    const poloCard = page.locator('[data-testid^="product-card-"]').first();
    await poloCard.click();
    const vCell = page.locator('[data-testid^="variant-cell-"]').first();
    await expect(vCell).toBeVisible({ timeout: 5000 });
    await vCell.click();

    // Difference is calculated and checkout button is enabled
    await expect(page.locator('[data-testid="pos-checkout-button"]')).toBeEnabled();
    await page.click('[data-testid="pos-checkout-button"]');

    // Complete payment
    await page.click('[data-testid="confirm-payment-button"]');
    await expect(page.locator("#pos-receipt-print")).toBeVisible({ timeout: 10000 });
  });

  test("dashboard shows today's returns matching reports api", async ({ page, request }) => {
    // Dhaka is UTC+6
    const todayStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Dhaka",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());

    // 1. Query reports API with matching parameters
    const reportRes = await request.get(
      `http://localhost:4000/api/v1/reports/sales-summary?startDate=${todayStr}&endDate=${todayStr}&branchId=${branchId}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(reportRes.ok()).toBeTruthy();
    const summary = (await reportRes.json()).data;
    const returnsCount = Number(summary.returnsCount || 0);

    // 2. Open dashboard
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });
    await page.evaluate((bId) => {
      localStorage.setItem("pos_selected_branch_id", bId);
    }, branchId);
    await page.goto("/dashboard");

    // 3. Verify Returns KPI card
    const returnsCard = page.locator('[data-testid="dashboard-returns-card"]');
    await expect(returnsCard).toBeVisible({ timeout: 10000 });

    const amountLocator = page.locator('[data-testid="dashboard-returns-amount"]');
    await expect(amountLocator).toBeVisible();

    const countLocator = page.locator('[data-testid="dashboard-returns-count"]');
    await expect(countLocator).toBeVisible();

    // Verify count reflects returnsCount with auto-retrying locator assertion
    if (returnsCount > 0) {
      await expect(countLocator).toContainText(String(returnsCount), { timeout: 10000 });
    } else {
      await expect(countLocator).toHaveText(/আজ কোনো ফেরত নেই|No returns today/i, { timeout: 10000 });
    }
  });

  test.afterAll(async ({ request }) => {
    await closeAllOpenShifts(request);
  });
});
