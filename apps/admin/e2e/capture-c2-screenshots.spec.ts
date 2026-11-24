import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Milestone C2 Screenshots Capture", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const screenshotsDir = path.resolve(repoRoot, "docs/screenshots/c2");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("captures all C2 screenshots (desktop & mobile, light & dark)", async ({ page, request }) => {
    test.setTimeout(90000);
    // 1. Authenticate with API as Owner
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    const loginData = await loginRes.json();
    const token = loginData.data.accessToken;

    // Close any lingering open shifts so Owner has a clean register state
    try {
      const openShiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (openShiftsRes.ok()) {
        const shiftsData = await openShiftsRes.json();
        const openShifts = Array.isArray(shiftsData.data) ? shiftsData.data : (shiftsData.data?.items || []);
        for (const s of openShifts) {
          await request.post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
          }).catch(() => {});
        }
      }
    } catch {}

    // Fetch branches and products
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = await branchesRes.json();
    const branchId = branches.data.find((b: any) => b.code === "GFS-01")?.id || branches.data[0].id;

    // Ensure register & open shift for Owner
    const registersRes = await request.get(`http://localhost:4000/api/v1/registers?branchId=${branchId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const registers = (await registersRes.json()).data;
    const registerId = registers[0].id;

    const shiftsRes = await request.get(`http://localhost:4000/api/v1/shifts?registerId=${registerId}&status=open`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const shifts = (await shiftsRes.json()).data;
    const openShifts = Array.isArray(shifts) ? shifts : (shifts.items || []);
    if (openShifts.length === 0) {
      await request.post("http://localhost:4000/api/v1/shifts/open", {
        headers: { Authorization: `Bearer ${token}` },
        data: { registerId, branchId, openingCashMinor: 500000 },
      });
    }

    // Create test customer
    const custPhone = `018${Math.floor(10000000 + Math.random() * 90000000)}`;
    const custRes = await request.post("http://localhost:4000/api/v1/customers", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        name: "সোহেল রানা (ক্রেডিট টেস্ট)",
        phone: custPhone,
        creditLimitMinor: 1000000, // ৳10,000 credit limit
      },
    });
    const custJson = await custRes.json();
    const customerId = custJson.data.id;

    // Sign in on UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/(pos|dashboard)/, { timeout: 15000 });

    // Ensure Bengali locale
    const localeBtn = page.locator('button:has-text("বাংলা"), button:has-text("English")').first();
    if (await localeBtn.isVisible()) {
      const text = await localeBtn.innerText();
      if (text.includes("English")) {
        await localeBtn.click();
      }
    }

    // 1. Due Ageing Report
    await page.goto("/reports/due");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "reports-due-ageing-desktop-bn.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/reports/due");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "reports-due-ageing-mobile-bn.png"),
      fullPage: true,
    });

    // 2. Customers List with Due Balance
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/customers");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "customers-list-due-sort-desktop-bn.png"),
      fullPage: true,
    });

    // 3. Customer Detail & Statement
    await page.goto(`/customers/${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "customer-detail-ledger-desktop-bn.png"),
      fullPage: true,
    });

    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/customers/${customerId}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "customer-detail-ledger-mobile-bn.png"),
      fullPage: true,
    });

    // 4. Due Collection Modal
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/customers/${customerId}`);
    await page.waitForLoadState("networkidle");
    const collectBtn = page.locator('button:has-text("বাকি আদায়")').first();
    if (await collectBtn.isVisible()) {
      await collectBtn.click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: path.join(screenshotsDir, "customer-due-collection-modal-desktop-bn.png"),
      });
      await page.keyboard.press("Escape");
    }

    // 5. Dashboard with Due stats
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: path.join(screenshotsDir, "dashboard-due-cards-desktop-bn.png"),
      fullPage: true,
    });

    // 6. POS Payment Dialog with Credit Option (Light & Dark)
    await page.goto("/pos");
    await page.waitForLoadState("networkidle");

    // Select customer via F9
    await page.click('[data-testid="customer-button"]');
    await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
    await page.fill('[data-testid="customer-search-input"]', custPhone);
    const searchResultItem = page.locator(`button:has-text("${custPhone}")`);
    if (await searchResultItem.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await searchResultItem.click();
      await page.waitForTimeout(400);
    }
    if (await page.locator('[role="dialog"]').isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }

    // Add item to cart
    const firstProduct = page.locator('[data-testid^="product-card-"]').first();
    if (await firstProduct.isVisible()) {
      await firstProduct.click();
      const variantCell = page.locator('[data-testid^="variant-cell-"]').first();
      if (await variantCell.waitFor({ state: "visible", timeout: 2000 }).then(() => true).catch(() => false)) {
        await variantCell.click();
      }
    }

    // Open checkout / payment dialog
    const checkoutBtn = page.locator('[data-testid="pos-checkout-button"]');
    if (await checkoutBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
      await checkoutBtn.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

      // Light desktop
      await page.screenshot({
        path: path.join(screenshotsDir, "pos-credit-payment-dialog-desktop-light-bn.png"),
      });

      // Switch to dark mode
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const themeBtn = page.locator('button[aria-label="থিম পরিবর্তন"], button[aria-label="Toggle theme"]').first();
      if (await themeBtn.isVisible()) {
        await themeBtn.click();
      }
      await checkoutBtn.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });

      // Dark desktop
      await page.screenshot({
        path: path.join(screenshotsDir, "pos-credit-payment-dialog-desktop-dark-bn.png"),
      });

      // Mobile dark
      await page.setViewportSize({ width: 375, height: 812 });
      await page.screenshot({
        path: path.join(screenshotsDir, "pos-credit-payment-dialog-mobile-dark-bn.png"),
      });

      // Mobile light
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (await themeBtn.isVisible()) {
        await themeBtn.click();
      }
      await checkoutBtn.click();
      await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
      await page.screenshot({
        path: path.join(screenshotsDir, "pos-credit-payment-dialog-mobile-light-bn.png"),
      });

      // Complete credit sale and capture receipt
      const completeBtn = page.locator('[data-testid="confirm-payment-button"]');
      if (await completeBtn.isVisible()) {
        await completeBtn.click();
        await page.waitForTimeout(1000);
        await page.setViewportSize({ width: 450, height: 700 });
        const receipt = page.locator('[data-testid="pos-thermal-receipt"], [data-testid="receipt-view"]').first();
        if (await receipt.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
          await receipt.screenshot({
            path: path.join(screenshotsDir, "credit-sale-thermal-receipt.png"),
          });
        }
      }
    }
  });
});
