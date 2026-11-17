import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { isValidEan13 } from "@universal-pos/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Milestone C4: Barcode Label Generation, Print Modal & Scan Back Verification", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const screenshotsDir = path.resolve(repoRoot, "docs/screenshots/c4");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("generates EAN-13 barcode, prints preview in multiple formats, and scans back at POS", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);

    // 1. Authenticate with API as Owner for pre-test setup
    const loginRes = await request.post("http://localhost:4000/api/v1/auth/login", {
      data: {
        tenantSlug: "artisan-apparel",
        email: "owner@artisan.com",
        password: "Password123!",
      },
    });
    expect(loginRes.ok()).toBe(true);
    const loginData = await loginRes.json();
    const token = loginData.data.accessToken;

    // Close any lingering open shifts so POS has a clean register state
    try {
      const openShiftsRes = await request.get("http://localhost:4000/api/v1/shifts?status=open", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (openShiftsRes.ok()) {
        const shiftsData = await openShiftsRes.json();
        const openShifts = Array.isArray(shiftsData.data)
          ? shiftsData.data
          : shiftsData.data?.items || [];
        for (const s of openShifts) {
          await request
            .post(`http://localhost:4000/api/v1/shifts/${s.id}/close`, {
              headers: { Authorization: `Bearer ${token}` },
              data: { closingCashMinor: Number(s.openingCashMinor || 50000) },
            })
            .catch(() => {});
        }
      }
    } catch {}

    // 2. Log in via UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 3. Go to Products list and click first product
    await page.goto("http://localhost:3000/catalog/products");
    await page.waitForLoadState("networkidle");

    // Click on the first product row link
    const targetRow = page.locator('table tbody tr:has-text("Kids Denim")').first();
    if (await targetRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await targetRow.click();
    } else {
      await page.locator('table tbody tr').first().click();
    }
    await page.waitForURL("**/catalog/products/*", { timeout: 10000 });

    // 4. Click Barcode Print button
    const printBtn = page.locator('[data-testid="print-barcodes-button"]');
    await expect(printBtn).toBeVisible({ timeout: 10000 });
    await printBtn.click();

    // 5. Verify Barcode Print Modal opens
    const modal = page.locator('[data-testid="barcode-print-modal"]');
    await expect(modal).toBeVisible();

    // If any item is missing barcode, click "বারকোড তৈরি" button to generate
    const generateAllBtn = modal.locator('button:has-text("বারকোড তৈরি")');
    if (await generateAllBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await generateAllBtn.click();
      await expect(modal.locator('svg[data-testid^="barcode-svg-"]').first()).toBeVisible({ timeout: 10000 });
    }

    // Capture screenshot: 38x25 thermal roll format preview
    await page.screenshot({
      path: path.join(screenshotsDir, "01-barcode-modal-thermal-38x25.png"),
      fullPage: false,
    });

    // 6. Switch format to 50x30 mm
    await page.getByRole("button", { name: "50×30 mm" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-barcode-modal-thermal-50x30.png"),
      fullPage: false,
    });

    // 7. Switch format to A4 3x8 sheet
    await page.getByRole("button", { name: "A4 শিট" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "03-barcode-modal-sheet-a4.png"),
      fullPage: false,
    });

    // 8. Find a rendered barcode SVG and get its value
    const barcodeSvg = modal.locator('svg[data-testid^="barcode-svg-"]').first();
    await expect(barcodeSvg).toBeVisible({ timeout: 5000 });
    const testId = await barcodeSvg.getAttribute("data-testid");
    const scannedBarcode = testId?.replace("barcode-svg-", "").trim();
    expect(scannedBarcode).toBeTruthy();
    expect(isValidEan13(scannedBarcode!)).toBe(true);

    // 9. Close modal
    await modal.locator('button[aria-label="Close"]').click();
    await expect(modal).not.toBeVisible();

    // 10. Open shift on Register 1 if prompted at /pos
    await page.goto("http://localhost:3000/pos");
    await page.waitForLoadState("networkidle");

    const openShiftSubmit = page.locator('button:has-text("শিফট শুরু করুন"), button:has-text("Open Shift")');
    if (await openShiftSubmit.isVisible({ timeout: 2500 }).catch(() => false)) {
      await openShiftSubmit.click();
      await page.waitForTimeout(1000);
    }

    // 11. Scan / type the generated EAN-13 barcode into the POS search input
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(scannedBarcode!);
    await searchInput.press("Enter");

    // 12. Assert item was added to the cart
    const firstQtyInput = page.locator('[data-testid="qty-input-0"]');
    await expect(firstQtyInput).toBeVisible({ timeout: 10000 });
    await expect(firstQtyInput).toHaveValue("1");

    // Capture screenshot of POS with scanned product in cart
    await page.screenshot({
      path: path.join(screenshotsDir, "04-pos-scanned-ean13-cart.png"),
      fullPage: false,
    });
  });
});
