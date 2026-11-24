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
    if (await targetRow.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
      await targetRow.click();
    } else {
      await page.locator('table tbody tr').first().click();
    }
    await page.waitForURL("**/catalog/products/*", { timeout: 10000 });

    // Capture screenshot: Product detail page with Barcode Print button
    const printBtn = page.locator('[data-testid="print-barcodes-button"]');
    await expect(printBtn).toBeVisible({ timeout: 10000 });
    await page.screenshot({
      path: path.join(screenshotsDir, "08-product-page-generate-barcode.png"),
      fullPage: false,
    });

    // 4. Click Barcode Print button
    await printBtn.click();

    // 5. Verify Barcode Print Modal opens
    const modal = page.locator('[data-testid="barcode-print-modal"]');
    await expect(modal).toBeVisible();

    // If any item is missing barcode, click "বারকোড তৈরি" button to generate
    const generateAllBtn = modal.locator('button:has-text("বারকোড তৈরি")');
    if (await generateAllBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await generateAllBtn.click();
      await expect(modal.locator('svg[data-testid^="barcode-svg-"]').first()).toBeVisible({ timeout: 10000 });
    }

    // Capture screenshot: 38x25 thermal roll format preview (desktop)
    await page.screenshot({
      path: path.join(screenshotsDir, "01-barcode-modal-thermal-38x25.png"),
      fullPage: false,
    });

    // Capture print preview card crop for 38x25 (barcode number and price clearly readable)
    const previewCard38x25 = modal.locator(".shadow-sm").first();
    await expect(previewCard38x25).toBeVisible({ timeout: 5000 });
    await previewCard38x25.screenshot({
      path: path.join(screenshotsDir, "05-print-preview-38x25.png"),
    });

    // 6. Switch format to 50x30 mm
    await page.getByRole("button", { name: "50×30 mm" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-barcode-modal-thermal-50x30.png"),
      fullPage: false,
    });

    // Capture print preview card crop for 50x30
    const previewCard50x30 = modal.locator(".shadow-sm").first();
    await expect(previewCard50x30).toBeVisible({ timeout: 5000 });
    await previewCard50x30.screenshot({
      path: path.join(screenshotsDir, "06-print-preview-50x30.png"),
    });

    // 7. Switch format to A4 3x8 sheet
    await page.getByRole("button", { name: "A4 শিট" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "03-barcode-modal-sheet-a4.png"),
      fullPage: false,
    });

    // Capture print preview card crop for A4 3x8
    const previewCardA4 = modal.locator(".shadow-sm").first();
    await expect(previewCardA4).toBeVisible({ timeout: 5000 });
    await previewCardA4.screenshot({
      path: path.join(screenshotsDir, "07-print-preview-a4-3x8.png"),
    });

    // 8. Mobile 375px screenshots for all 3 formats
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);

    // Mobile: A4
    await page.screenshot({
      path: path.join(screenshotsDir, "03-barcode-modal-sheet-a4-mobile.png"),
      fullPage: false,
    });

    // Mobile: 50x30
    await page.getByRole("button", { name: "50×30 mm" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-barcode-modal-thermal-50x30-mobile.png"),
      fullPage: false,
    });

    // Mobile: 38x25
    await page.getByRole("button", { name: "38×25 mm" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "01-barcode-modal-thermal-38x25-mobile.png"),
      fullPage: false,
    });

    // Reset viewport to desktop
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    // 9. Find a rendered barcode SVG and get its value
    const barcodeSvg = modal.locator('svg[data-testid^="barcode-svg-"]').first();
    await expect(barcodeSvg).toBeVisible({ timeout: 5000 });
    const testId = await barcodeSvg.getAttribute("data-testid");
    const scannedBarcode = testId?.replace("barcode-svg-", "").trim();
    expect(scannedBarcode).toBeTruthy();
    expect(isValidEan13(scannedBarcode!)).toBe(true);

    // 10. Close modal
    await modal.locator('button[aria-label="Close"]').click();
    await expect(modal).not.toBeVisible();

    // 11. Open shift on Register 1 if prompted at /pos
    await page.goto("http://localhost:3000/pos");
    await page.waitForLoadState("networkidle");

    const switchBtn = page.locator('[data-testid="switch-register-btn"]');
    if (await switchBtn.waitFor({ state: "visible", timeout: 3000 }).then(() => true).catch(() => false)) {
      await switchBtn.click();
      await expect(switchBtn).toBeHidden({ timeout: 5000 });
    }
    const openShiftSubmit = page.locator('button:has-text("শিফট শুরু করুন"), button:has-text("Open Shift"), [data-testid="open-shift-button"]');
    if (await openShiftSubmit.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false)) {
      await openShiftSubmit.click();
      const confirmShift = page.locator('[data-testid="confirm-open-shift-button"]');
      if (await confirmShift.waitFor({ state: "visible", timeout: 2500 }).then(() => true).catch(() => false)) {
        await page.fill('[data-testid="opening-cash-input"]', "500");
        await confirmShift.click();
        await expect(confirmShift).toBeHidden({ timeout: 5000 });
      }
    }

    // 12. Scan / type the generated EAN-13 barcode into the POS search input
    const searchInput = page.locator('[data-testid="pos-search-input"]');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(scannedBarcode!);
    await searchInput.press("Enter");

    // 13. Assert item was added to the cart
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
