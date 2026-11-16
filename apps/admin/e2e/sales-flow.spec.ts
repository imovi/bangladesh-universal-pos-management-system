import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";

test.describe("Milestone A6: Sales, Customers, Registers & Shifts Flow", () => {
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
    const token = loginData.data.accessToken;

    // 2. Fetch or create branch and register
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = await branchesRes.json();
    branchId = branches.data[0].id;

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
          name: "Main Checkout POS",
          code: "POS-01",
        },
      });
      const regJson = await createRegRes.json();
      registerId = regJson.data.id;
    }

    // 3. Check for open shift or open one
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
          openingCashMinor: 25000,
        },
      });
      const openJson = await openRes.json();
      shiftId = openJson.data.id;
    }

    // 4. Get a variant and ensure stock
    const prodsRes = await request.get("http://localhost:4000/api/v1/products", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prodsJson = await prodsRes.json();
    const products = Array.isArray(prodsJson.data) ? prodsJson.data : (prodsJson.data?.items || []);
    const product = products[0];
    variantId = product.variants[0].id;
    const priceMinor = product.variants[0].priceMinor || 100000;

    await request.post("http://localhost:4000/api/v1/inventory/opening-stock", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        branchId,
        items: [{ variantId, quantity: 50, unitCostMinor: 40000 }],
      },
    });

    // 5. Post a completed sale
    saleId = uuidv7();
    const postSaleRes = await request.post("http://localhost:4000/api/v1/sales", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Idempotency-Key": saleId,
      },
      data: {
        id: saleId,
        shiftId,
        branchId,
        items: [{ variantId, quantity: 1 }],
        payments: [{ paymentMethod: "cash", amountMinor: priceMinor }],
        expectedTotalMinor: priceMinor,
      },
    });
    expect(postSaleRes.ok()).toBeTruthy();
    const saleJson = await postSaleRes.json();
    invoiceNumber = saleJson.data.invoiceNumber;
  });

  test("cashier cannot see void button on sale detail page", async ({ page }) => {
    // 1. Sign in as Cashier
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "cashier@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');

    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 2. Navigate directly to the sale detail page
    await page.goto(`/sales/${saleId}`);

    // Wait for sale detail page to load
    await expect(page.locator("h1")).toContainText(invoiceNumber, { timeout: 10000 });

    // Verify Void button is NOT visible for cashier
    await expect(page.getByRole("button", { name: /বাতিল|Void/i })).not.toBeVisible();
  });

  test("owner finds sale by receipt number, voids it with reason, and manages customers and shifts", async ({
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

    // 2. Go to Sales list
    await page.goto("/sales");
    await expect(page.locator("h1")).toContainText(/বিক্রয় ইতিহাস|Sales History/i);

    // Search by receipt number
    const searchInput = page.locator('input[placeholder*="রশিদ"], input[placeholder*="receipt"]');
    await searchInput.fill(invoiceNumber);
    await page.waitForTimeout(500);

    // Confirm the filtered sale is present
    const saleRow = page.locator("tr", { hasText: invoiceNumber });
    await expect(saleRow).toBeVisible();

    // Click to view sale detail
    await saleRow.locator("a", { hasText: invoiceNumber }).click();
    await page.waitForURL(`**/sales/${saleId}`, { timeout: 10000 });

    // 3. On Sale Detail page, verify Void button IS visible for Owner
    const voidBtn = page.getByRole("button", { name: /বাতিল|Void/i });
    await expect(voidBtn).toBeVisible();

    // Click void button to open modal
    await voidBtn.click();

    // Modal appears, enter void reason
    const reasonInput = page.locator('input[placeholder*="error"], input[placeholder*="কারণ"]');
    await reasonInput.fill("Customer requested return and refund due to size mismatch");

    // Confirm void
    const confirmBtn = page.getByRole("button", { name: /বাতিল নিশ্চিত|Confirm Void/i });
    await confirmBtn.click();

    // Wait for status badge to update to Voided
    await expect(page.locator("text=/বাতিলকৃত|Voided/i").first()).toBeVisible({ timeout: 10000 });

    // 4. Customer Management Test
    await page.goto("/customers");
    await expect(page.locator("h1")).toContainText(/গ্রাহক|Customers/i);

    // Open add customer modal
    const addCustBtn = page.getByRole("button", { name: /নতুন গ্রাহক|New Customer/i });
    await addCustBtn.click();

    const timestamp = Date.now();
    const custName = `Kabir Hossain ${timestamp}`;
    const custPhone = `018${String(timestamp).slice(-8)}`;

    const nameInput = page.locator('input[required]').first();
    await nameInput.fill(custName);

    const phoneInput = page.locator('input[placeholder*="017"], input[placeholder*="phone"]').first();
    await phoneInput.fill(custPhone);

    const saveCustBtn = page.getByRole("button", { name: /সংরক্ষণ|Save/i });
    await saveCustBtn.click();

    // Verify new customer appears in customer list
    const custSearch = page.locator('input[placeholder*="নাম বা মোবাইল"], input[placeholder*="Search"]');
    await custSearch.fill(custName);
    await page.waitForTimeout(500);
    await expect(page.locator("tr", { hasText: custName })).toBeVisible();

    // 5. Cash Registers Page Test
    await page.goto("/registers");
    await expect(page.locator("h1")).toContainText(/রেজিস্টার|Registers/i);
    await expect(page.locator("table")).toBeVisible();

    // 6. Shift Details Page Test
    await page.goto(`/shifts/${shiftId}`);
    await expect(page.locator("h1")).toContainText(/শিফট|Shift/i);
    await expect(page.locator("text=/Reconciliation|সমন্বয়/i").first()).toBeVisible();
    await expect(page.locator("text=/Payment Method|পেমেন্ট মাধ্যম/i").first()).toBeVisible();
  });
});
