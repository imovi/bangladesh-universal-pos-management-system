import { test, expect } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe("Milestone C5: Phase 1C Reports Flow & Screen Verification", () => {
  const repoRoot = path.resolve(__dirname, "../../../");
  const screenshotsDir = path.resolve(repoRoot, "docs/screenshots/c5");

  test.beforeAll(() => {
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
  });

  test("verifies returns report, damaged stock report, and due ageing CSV export", async ({
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

    // 2. Fetch API Returns and Damaged figures to assert against screen numbers
    const apiReturnsRes = await request.get("http://localhost:4000/api/v1/reports/returns", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(apiReturnsRes.ok()).toBe(true);
    const apiReturnsData = await apiReturnsRes.json();
    const expectedReturnsCount = String(apiReturnsData.data.summary.returnsCount);

    const apiDamagedRes = await request.get("http://localhost:4000/api/v1/reports/damaged-stock", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(apiDamagedRes.ok()).toBe(true);
    const apiDamagedData = await apiDamagedRes.json();
    const expectedDamagedUnits = String(apiDamagedData.data.summary.totalDamagedUnits);

    // 3. Log in via UI
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/login");
    await page.fill("#tenantSlug", "artisan-apparel");
    await page.fill("#email", "owner@artisan.com");
    await page.fill("#password", "Password123!");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard", { timeout: 15000 });

    // 4. Returns Report (/reports/returns) - Desktop 1440px
    await page.goto("http://localhost:3000/reports/returns");
    await page.waitForLoadState("networkidle");

    const returnsBranchSelect = page.locator('select').first();
    await returnsBranchSelect.selectOption({ value: "" });
    await page.waitForTimeout(400);

    const returnsCountEl = page.locator('[data-testid="returns-count"]');
    await expect(returnsCountEl).toBeVisible({ timeout: 10000 });
    // Screen number strictly matches API response
    await expect(returnsCountEl).toContainText(expectedReturnsCount);

    await expect(page.locator('[data-testid="export-returns-csv-btn"]')).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotsDir, "01-returns-report-desktop.png"),
      fullPage: false,
    });

    // Mobile Viewport (375px) for Returns Report
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "02-returns-report-mobile.png"),
      fullPage: false,
    });

    // 5. Damaged Stock Report (/reports/damaged) - Desktop 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/reports/damaged");
    await page.waitForLoadState("networkidle");

    const damagedBranchSelect = page.locator('select').first();
    await damagedBranchSelect.selectOption({ value: "" });
    await page.waitForTimeout(400);

    const damagedUnitsEl = page.locator('[data-testid="damaged-total-units"]');
    await expect(damagedUnitsEl).toBeVisible({ timeout: 10000 });
    // Screen number strictly matches API response
    await expect(damagedUnitsEl).toContainText(expectedDamagedUnits);

    await expect(page.locator('[data-testid="export-damaged-csv-btn"]')).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotsDir, "03-damaged-stock-report-desktop.png"),
      fullPage: false,
    });

    // Mobile Viewport (375px) for Damaged Stock Report
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "04-damaged-stock-report-mobile.png"),
      fullPage: false,
    });

    // 6. Due Ageing Report (/reports/due) - Desktop 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("http://localhost:3000/reports/due");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("h1")).toContainText(/বাকি|Due/);
    await expect(page.locator('[data-testid="export-due-csv-btn"]')).toBeVisible();

    await page.screenshot({
      path: path.join(screenshotsDir, "05-due-ageing-report-desktop.png"),
      fullPage: false,
    });

    // Mobile Viewport (375px) for Due Ageing Report
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotsDir, "06-due-ageing-report-mobile.png"),
      fullPage: false,
    });
  });
});
