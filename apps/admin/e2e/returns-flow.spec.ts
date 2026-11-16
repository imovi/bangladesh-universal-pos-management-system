import { test, expect } from "@playwright/test";
import { v7 as uuidv7 } from "uuid";

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

    // Adjust stock up
    await request.post("http://localhost:4000/api/v1/inventory/adjustments", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        branchId,
        items: [{ variantId, qtyDelta: 20 }],
        reason: "Returns test stock",
      },
    });

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
        payments: [{ paymentMethod: "cash", amountMinor: 200000 }], // ৳2000 cash
      },
    });
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
    await expect(page.locator("h1")).toContainText(/পণ্য ফেরত ও বদল|Product Returns & Exchanges/i, {
      timeout: 10000,
    });

    // Verify table headers
    await expect(page.locator("body")).toContainText(/ফেরত নম্বর|Return #/i);
    await expect(page.locator("body")).toContainText(/মূল বিক্রয়|Original Sale/i);
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

    // Verify returnable qty column is shown in items table
    await expect(page.locator("body")).toContainText(/ফেরতযোগ্য|Returnable/i);
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
    await expect(page.locator("body")).toContainText(/ফেরতের ইতিহাস|Return History/i);
  });
});
