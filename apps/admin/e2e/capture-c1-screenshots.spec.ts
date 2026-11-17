import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import { v7 as uuidv7 } from "uuid";

const screenshotsDir = path.resolve(process.cwd(), "docs/screenshots/c1");

test.describe("Milestone C1: Capture Required Screenshots", () => {
  let token: string;
  let branchId: string;
  let registerId: string;
  let shiftId: string;
  let saleId: string;
  let invoiceNumber: string;
  let returnId: string;

  test.beforeAll(async ({ request }) => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }

    // 1. Authenticate as Owner
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    const loginData = await loginRes.json();
    token = loginData.data.accessToken;

    // 2. Fetch GFS-01 branch
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = (await branchesRes.json()).data;
    branchId = branches.find((b: any) => b.code === "GFS-01")?.id || branches[0].id;

    // 3. Register and shift
    const registersRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = (await registersRes.json()).data;
    registerId = registers[0].id;

    const shiftsRes = await request.get(`http://localhost:4000/api/v1/shifts?registerId=${registerId}&status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const shifts = (await shiftsRes.json()).data;
    const openShifts = Array.isArray(shifts) ? shifts : (shifts.items || []);
    if (openShifts.length > 0) {
      shiftId = openShifts[0].id;
    } else {
      const openRes = await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: { registerId, branchId, openingCashMinor: 500000 },
      });
      shiftId = (await openRes.json()).data.id;
    }

    // 4. Products and stock
    const productsRes = await request.get("http://localhost:4000/api/v1/products?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prods = (await productsRes.json()).data;
    const prodList = prods.items || prods;
    const v1Obj = prodList[0].variants[0];
    const v2Obj = prodList[1]?.variants?.[0] || prodList[0].variants[1];
    const v1 = v1Obj.id;
    const v2 = v2Obj.id;
    const v1Price = Number(v1Obj.priceMinor);
    const v2Price = Number(v2Obj.priceMinor);
    const totalMinor = v1Price * 2 + v2Price;

    // Adjust stock up
    for (const p of prodList.slice(0, 3)) {
      for (const v of p.variants || []) {
        await request.post("http://localhost:4000/api/v1/inventory/adjustment", {
          headers: { Authorization: `Bearer ${token}` },
          data: { branchId, variantId: v.id, qtyDelta: 50, reason: "C1 screenshot stock" },
        });
      }
    }

    // 5. Create a sale to return
    saleId = uuidv7();
    const saleRes = await request.post("http://localhost:4000/api/v1/sales", {
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": saleId },
      data: {
        id: saleId,
        shiftId,
        branchId,
        items: [
          { variantId: v1, quantity: 2 },
          { variantId: v2, quantity: 1 },
        ],
        payments: [{ paymentMethod: "cash", amountMinor: totalMinor }],
        expectedTotalMinor: totalMinor,
      },
    });
    if (!saleRes.ok()) {
      console.log("Screenshot saleRes error:", saleRes.status(), await saleRes.text());
    }
    const saleJson = await saleRes.json();
    invoiceNumber = saleJson.data.invoiceNumber;
    const saleItemId = saleJson.data.items[0].id;

    // 6. Create a return record for detail page
    returnId = uuidv7();
    const retRes = await request.post(`http://localhost:4000/api/v1/sales/${saleId}/returns`, {
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": returnId },
      data: {
        id: returnId,
        shiftId,
        refundMethod: "cash",
        reason: "Size fit issue",
        items: [{ saleItemId, quantity: 1, condition: "resellable" }],
      },
    });
    expect(retRes.ok()).toBeTruthy();
  });

  test("capture screenshots across desktop and mobile, light and dark", async ({ page }) => {
    // 1. Sign in
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // --- Screenshot 1: /pos return dialog (Desktop Light, BN) ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/pos");
    await page.waitForSelector('[data-testid="pos-return-button"]', { timeout: 10000 });
    await page.click('[data-testid="pos-return-button"]');
    await page.fill('[data-testid="return-invoice-input"]', invoiceNumber);
    await page.click('[data-testid="search-invoice-button"]');
    await expect(page.locator('[data-testid="return-qty-plus-0"]')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, "pos-return-dialog-desktop-light-bn.png") });

    // --- Screenshot 2: /pos return dialog (Desktop Dark, BN) ---
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(screenshotsDir, "pos-return-dialog-desktop-dark-bn.png") });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    // --- Screenshot 3 & 4: /pos return dialog (Mobile 375px Light & Dark, BN) ---
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(screenshotsDir, "pos-return-dialog-mobile-light-bn.png") });
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(screenshotsDir, "pos-return-dialog-mobile-dark-bn.png") });
    await page.evaluate(() => document.documentElement.classList.remove("dark"));

    // --- Screenshot 5 & 6: Exchange cart with negative difference (Desktop & Mobile) ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-testid="return-qty-plus-0"]');
    await page.click('[data-testid="proceed-exchange-button"]');
    await expect(page.locator("body")).toContainText(/পণ্য বদল মোড|Exchange Mode/i, { timeout: 8000 });
    await page.screenshot({ path: path.join(screenshotsDir, "exchange-cart-negative-difference-desktop.png") });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(screenshotsDir, "exchange-cart-negative-difference-mobile.png") });

    // --- Screenshot 7 & 8: Thermal return receipt (80mm & 58mm) ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-testid="pos-return-button"]');
    await page.fill('[data-testid="return-invoice-input"]', invoiceNumber);
    await page.click('[data-testid="search-invoice-button"]');
    await expect(page.locator('[data-testid="return-qty-plus-0"]')).toBeVisible({ timeout: 8000 });
    await page.click('[data-testid="return-qty-plus-0"]');
    await page.click('[data-testid="confirm-return-button"]');
    await expect(page.locator('[data-testid="return-receipt-title"]')).toBeVisible({ timeout: 10000 });
    const receiptBox = page.locator("#pos-return-receipt-print");
    await expect(receiptBox).toBeVisible();
    await receiptBox.screenshot({ path: path.join(screenshotsDir, "thermal-return-receipt-80mm.png") });

    // Resize container or capture 58mm view
    await page.evaluate(() => {
      const el = document.getElementById("pos-return-receipt-print");
      if (el) el.style.maxWidth = "280px";
    });
    await page.waitForTimeout(200);
    await receiptBox.screenshot({ path: path.join(screenshotsDir, "thermal-return-receipt-58mm.png") });
    const doneBtn = page.locator('[data-testid="return-receipt-done-button"]');
    if (await doneBtn.isVisible()) await doneBtn.click();

    // --- Screenshot 9 & 10: /sales/returns list with pagination and branch filter (Desktop & Mobile) ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/sales/returns");
    await expect(page.locator("h1")).toContainText(/পণ্য ফেরত|Product Returns/i, { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, "sales-returns-list-desktop-bn.png") });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({ path: path.join(screenshotsDir, "sales-returns-list-mobile-bn.png") });

    // --- Screenshot 11: Return detail page ---
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/sales/returns/${returnId}`);
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, "return-detail-page-desktop-bn.png") });

    // --- Screenshot 12: Sale detail page with return history ---
    await page.goto(`/sales/${saleId}`);
    await expect(page.locator("h1")).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotsDir, "sale-detail-with-return-history-desktop-bn.png") });
  });
});
