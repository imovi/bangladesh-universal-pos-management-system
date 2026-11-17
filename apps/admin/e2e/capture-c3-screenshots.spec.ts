import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const screenshotsDir = path.resolve(__dirname, "../../../docs/screenshots/c3");

test.describe("Milestone C3 Screenshots Capture", () => {
  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("captures all C3 screenshots (desktop & mobile, light & dark)", async ({ page, request }) => {
    test.setTimeout(120000);

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

    // Fetch branches and variants
    const branchesRes = await request.get("http://localhost:4000/api/v1/branches", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const branches = (await branchesRes.json()).data;
    const branchA = branches.find((b: any) => b.code === "GFS-01") || branches[0];
    let branchB = branches.find((b: any) => b.code === "DF-01");

    if (!branchB) {
      const createBranchRes = await request.post("http://localhost:4000/api/v1/branches", {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          name: "Dhanmondi Fashion Outlet",
          code: "DF-01",
          address: "Road 27, Dhanmondi, Dhaka",
        },
      });
      branchB = (await createBranchRes.json()).data;
    }

    // Fetch products
    const prodsRes = await request.get("http://localhost:4000/api/v1/products?limit=5", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const prods = (await prodsRes.json()).data;
    const prod = prods.items ? prods.items[0] : prods[0];
    const variantId1 = prod.variants[0].id;
    const variantId2 = prod.variants[1]?.id || prod.variants[0].id;

    // Seed a sent transfer for screenshotting
    const seedTransferRes = await request.post("http://localhost:4000/api/v1/inventory/transfers", {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        sourceBranchId: branchA.id,
        destinationBranchId: branchB.id,
        notes: "Dhaka Inter-branch Stock Transfer",
        items: [
          { variantId: variantId1, quantity: 15 },
          { variantId: variantId2, quantity: 10 },
        ],
      },
    });
    const seedTransfer = (await seedTransferRes.json()).data;
    await request.post(`http://localhost:4000/api/v1/inventory/transfers/${seedTransfer.id}/send`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { notes: "Dispatched via logistics van" },
    });

    // 2. Login via UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login");
    await page.fill('input[name="tenantSlug"], [data-testid="tenant-slug-input"]', "artisan-apparel");
    await page.fill('input[name="email"], [data-testid="email-input"]', "owner@artisan.com");
    await page.fill('input[name="password"], [data-testid="password-input"]', "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // Screenshot 1: Transfers List Desktop Light
    await page.goto("/inventory/transfers");
    await page.waitForSelector('[data-testid="transfers-table"]');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(screenshotsDir, "01-transfers-list-desktop-light.png"),
      fullPage: true,
    });

    // Screenshot 2: Transfers List Desktop Dark
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-transfers-list-desktop-dark.png"),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
    });

    // Screenshot 3: Transfers List Mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotsDir, "03-transfers-list-mobile.png"),
      fullPage: true,
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // Screenshot 4: Transfer Create with Size-Color Grid Desktop
    await page.goto("/inventory/transfers/new");
    await page.waitForSelector('[data-testid="transfer-product-select"]');
    await page.selectOption('[data-testid="transfer-product-select"]', prod.id);
    await page.waitForSelector('input[type="number"]');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(screenshotsDir, "04-transfer-create-grid-desktop.png"),
      fullPage: true,
    });

    // Screenshot 5: Transfer Create with Size-Color Grid Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotsDir, "05-transfer-create-grid-mobile.png"),
      fullPage: true,
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // Screenshot 6: Transfer Detail Desktop
    await page.goto(`/inventory/transfers/${seedTransfer.id}`);
    await page.waitForSelector('[data-testid="transfer-number-title"]');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(screenshotsDir, "06-transfer-detail-desktop.png"),
      fullPage: true,
    });

    // Screenshot 7: Transfer Detail Receive Mode
    await page.waitForSelector('[data-testid="receive-section"]');
    await page.screenshot({
      path: path.join(screenshotsDir, "07-transfer-detail-receive-mode.png"),
      fullPage: true,
    });

    // Screenshot 8: Transfer Detail Mobile
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: path.join(screenshotsDir, "08-transfer-detail-mobile.png"),
      fullPage: true,
    });

    // Restore desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    // Screenshot 9: Printable Transfer Note Preview
    await page.goto(`/inventory/transfers/${seedTransfer.id}`);
    await page.waitForSelector("#printable-transfer-note");
    const printElement = page.locator("#printable-transfer-note");
    await printElement.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await printElement.screenshot({
      path: path.join(screenshotsDir, "09-transfer-note-print-preview.png"),
    });

    // Screenshot 10: Stock Levels with In-Transit column
    await page.goto("/inventory/stock");
    await page.waitForSelector('[data-testid="stock-levels-table"]');
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(screenshotsDir, "10-stock-levels-in-transit.png"),
      fullPage: true,
    });
  });
});
