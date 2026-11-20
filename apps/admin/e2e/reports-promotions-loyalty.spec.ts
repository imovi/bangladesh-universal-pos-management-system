import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function formatMoney(minorUnits: number | bigint | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined) return "—";
  const num = Number(minorUnits) / 100;
  const formatted = num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `৳ ${formatted}`;
}

test.describe("Milestone E5: Reports & Dashboard Flow with API Assertions", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const screenshotsDir = path.resolve(repoRoot, "docs/screenshots/e5");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("verifies dashboard KPIs, promotions report, and loyalty report against API", async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);

    // 1. Authenticate with API as Owner
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

    // 2. Fetch API Sales Summary for today
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const summaryRes = await request.get(
      `http://localhost:4000/api/v1/reports/sales-summary?startDate=${todayStr}&endDate=${todayStr}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(summaryRes.ok()).toBe(true);
    const summaryJson = await summaryRes.json();
    const summary = summaryJson.data || summaryJson;
    const expectedPromoDiscount = formatMoney(summary.totalPromotionDiscountMinor || 0);
    const expectedPointsPaid = formatMoney(summary.paymentsByMethod?.["points"] || 0);

    // 3. Log in via UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 4. Assert Dashboard KPIs against API figures
    const promoDiscountEl = page.locator('[data-testid="dashboard-promotion-discount"]');
    await expect(promoDiscountEl).toBeVisible({ timeout: 10000 });
    await expect(promoDiscountEl).toContainText(expectedPromoDiscount);

    const pointsPaidEl = page.locator('[data-testid="dashboard-points-paid"]');
    await expect(pointsPaidEl).toBeVisible({ timeout: 10000 });
    await expect(pointsPaidEl).toContainText(expectedPointsPaid);

    // Capture dashboard screenshots (Bangla, light mode)
    await page.screenshot({
      path: path.join(screenshotsDir, "01-dashboard-desktop.png"),
      fullPage: false,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, "01-dashboard-mobile.png"),
      fullPage: false,
    });

    // 5. Navigate to Promotions Report (/reports/promotions)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/reports/promotions");
    await page.waitForLoadState("domcontentloaded");

    // Fetch API promotions report to compare
    const promoReportRes = await request.get("http://localhost:4000/api/v1/reports/promotions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(promoReportRes.ok()).toBe(true);
    const promoReportJson = await promoReportRes.json();
    const promoData = promoReportJson.data || promoReportJson;

    // Assert KPI cards
    const promoSalesKpi = page.locator('[data-testid="kpi-promoted-sales"]');
    await expect(promoSalesKpi).toBeVisible({ timeout: 10000 });
    await expect(promoSalesKpi).toContainText(String(promoData.summary.totalSalesCount));

    const promoDiscountKpi = page.locator('[data-testid="kpi-discount-given"]');
    await expect(promoDiscountKpi).toBeVisible();
    await expect(promoDiscountKpi).toContainText(formatMoney(promoData.summary.totalDiscountGivenMinor));

    // Assert CSV export button
    const promoExportBtn = page.locator('[data-testid="export-promotions-csv"]');
    await expect(promoExportBtn).toBeVisible();

    // Capture promotions report screenshots
    await page.screenshot({
      path: path.join(screenshotsDir, "02-promotions-report-desktop.png"),
      fullPage: false,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-promotions-report-mobile.png"),
      fullPage: false,
    });

    // 6. Navigate to Loyalty Report (/reports/loyalty)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/reports/loyalty");
    await page.waitForLoadState("domcontentloaded");

    // Fetch API loyalty report to compare
    const loyaltyReportRes = await request.get("http://localhost:4000/api/v1/reports/loyalty", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(loyaltyReportRes.ok()).toBe(true);
    const loyaltyReportJson = await loyaltyReportRes.json();
    const loyaltyData = loyaltyReportJson.data || loyaltyReportJson;

    // Assert KPI cards
    const outstandingPointsKpi = page.locator('[data-testid="kpi-outstanding-points"]');
    await expect(outstandingPointsKpi).toBeVisible({ timeout: 10000 });
    await expect(outstandingPointsKpi).toContainText(
      loyaltyData.summary.totalOutstandingPoints.toLocaleString()
    );

    const liabilityKpi = page.locator('[data-testid="kpi-shop-liability"]');
    await expect(liabilityKpi).toBeVisible();
    await expect(liabilityKpi).toContainText(formatMoney(loyaltyData.summary.liabilityMinor));

    // Assert tables or empty state container
    const customersTable = page.locator('[data-testid="loyalty-top-customers-table"]');
    const monthlyTable = page.locator('[data-testid="loyalty-monthly-table"]');
    const isCustomersVisible = await customersTable.isVisible().catch(() => false);
    const isMonthlyVisible = await monthlyTable.isVisible().catch(() => false);

    // If data exists, tables should be present
    if (loyaltyData.topCustomers.length > 0) {
      await expect(customersTable).toBeVisible();
    }
    if (loyaltyData.monthly.length > 0) {
      await expect(monthlyTable).toBeVisible();
    }

    // Assert CSV export button
    const loyaltyExportBtn = page.locator('[data-testid="export-loyalty-csv"]');
    await expect(loyaltyExportBtn).toBeVisible();

    // Capture loyalty report screenshots
    await page.screenshot({
      path: path.join(screenshotsDir, "03-loyalty-report-desktop.png"),
      fullPage: false,
    });

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(screenshotsDir, "03-loyalty-report-mobile.png"),
      fullPage: false,
    });
  });
});
